import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation, toError } from '../errors'
import { slugify, withSuffix } from '../slugify'

/** Famille de produits (public.product_categories, arborescence par parent_id). */
export type Family = {
  id: string
  parent_id: string | null
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export type FamilyNode = Family & { children: FamilyNode[]; depth: number }

const COLUMNS = 'id,parent_id,name,slug,description,sort_order,is_active'

export async function listFamilies(client: SupabaseClient, siteId: string): Promise<Family[]> {
  const { data, error } = await client.from('product_categories').select(COLUMNS)
    .eq('site_id', siteId).order('sort_order').order('name')
  if (error) throw toError(error)
  return (data ?? []) as Family[]
}

/** Arbre trié. Une famille dont le parent est introuvable est remontée à la racine (rien n'est masqué). */
export function buildFamilyTree(rows: Family[]): FamilyNode[] {
  const nodes = new Map<string, FamilyNode>()
  for (const row of rows) nodes.set(row.id, { ...row, children: [], depth: 0 })
  const roots: FamilyNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const visit = (list: FamilyNode[], depth: number, seen: Set<string>) => {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr'))
    for (const node of list) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      node.depth = depth
      visit(node.children, depth + 1, seen)
    }
  }
  const seen = new Set<string>()
  visit(roots, 0, seen)
  // Boucle parent ↔ enfant (donnée incohérente) : les familles concernées remontent à la racine.
  for (const node of nodes.values()) {
    if (seen.has(node.id)) continue
    for (const other of nodes.values()) other.children = other.children.filter((child) => child !== node)
    roots.push(node)
    visit([node], 0, seen)
  }
  return roots
}

/** Liste à plat dans l'ordre de l'arbre (pour les listes déroulantes indentées). */
export function flattenFamilies(tree: FamilyNode[]): FamilyNode[] {
  const out: FamilyNode[] = []
  const walk = (list: FamilyNode[]) => { for (const node of list) { out.push(node); walk(node.children) } }
  walk(tree)
  return out
}

/** Identifiants d'une famille et de toutes ses sous-familles (filtre « famille » de la liste produits). */
export function familyWithDescendants(rows: Family[], id: string): string[] {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) { ids.add(row.id); grew = true }
    }
  }
  return [...ids]
}

export async function createFamily(client: SupabaseClient, siteId: string, input: { name: string; parentId: string | null }): Promise<Family> {
  const name = input.name.trim()
  if (!name) throw new Error('Le nom de la famille est obligatoire.')
  if (name.length > 120) throw new Error('Le nom de la famille ne doit pas dépasser 120 caractères.')
  const base = slugify(name, 'famille')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { data, error } = await client.from('product_categories')
      .insert({ site_id: siteId, parent_id: input.parentId, name, slug: attempt === 1 ? base : withSuffix(base) })
      .select(COLUMNS).single()
    if (isUniqueViolation(error)) continue
    if (error) throw toError(error)
    return data as Family
  }
  throw new Error('Impossible de créer cette famille : identifiant déjà pris. Essayez un autre nom.')
}

/** Renommer, activer/désactiver ou réordonner. Pas de suppression : une famille se désactive. */
export async function updateFamily(
  client: SupabaseClient,
  siteId: string,
  id: string,
  patch: Partial<Pick<Family, 'name' | 'is_active' | 'sort_order' | 'description'>>,
): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Le nom de la famille est obligatoire.')
  const { error } = await client.from('product_categories')
    .update(patch.name !== undefined ? { ...patch, name: patch.name.trim() } : patch)
    .eq('id', id).eq('site_id', siteId)
  if (error) throw toError(error)
}
