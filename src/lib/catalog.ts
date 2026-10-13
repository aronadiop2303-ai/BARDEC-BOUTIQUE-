import type { SupabaseClient } from '@supabase/supabase-js'

/** Ligne de la table public.site_categories (colonnes lues par le Studio). */
export type SiteCategory = {
  id: string
  parent_id: string | null
  level: 1 | 2 | 3
  slug: string
  name: string
  description: string | null
  default_site_type: string | null
  sort_order: number
}

export type CategoryNode = SiteCategory & { children: CategoryNode[] }

const compareNodes = (a: CategoryNode, b: CategoryNode) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr')

/**
 * Transforme la liste plate en arbre trié.
 * Une ligne dont le parent est absent (ex. parent inactif, donc masqué par RLS) est ignorée :
 * on n'affiche jamais une spécialité sans son secteur.
 */
export function buildCategoryTree(rows: SiteCategory[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>()
  for (const row of rows) byId.set(row.id, { ...row, children: [] })

  const roots: CategoryNode[] = []
  for (const node of byId.values()) {
    if (node.parent_id === null) roots.push(node)
    else byId.get(node.parent_id)?.children.push(node)
  }

  const sortRecursively = (nodes: CategoryNode[]) => {
    nodes.sort(compareNodes)
    for (const node of nodes) sortRecursively(node.children)
  }
  sortRecursively(roots)
  return roots
}

/** « Commerce › Magasin › Quincaillerie » */
export function formatCategoryPath(path: CategoryNode[]): string {
  return path.map((node) => node.name).join(' › ')
}

/** Famille de site (sites.site_type) déduite de la catégorie la plus précise qui en déclare une. */
export function resolveSiteType(path: CategoryNode[]): string {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const siteType = path[i].default_site_type
    if (siteType) return siteType
  }
  return 'business'
}

const COLUMNS = 'id,parent_id,level,slug,name,description,default_site_type,sort_order'

/** Lit le catalogue actif. La sécurité repose sur la politique RLS (lecture seule, lignes actives). */
export async function fetchCategoryTree(client: SupabaseClient): Promise<CategoryNode[]> {
  const { data, error } = await client
    .from('site_categories')
    .select(COLUMNS)
    .order('level')
    .order('sort_order')

  if (error) throw new Error(error.message)
  return buildCategoryTree((data ?? []) as SiteCategory[])
}
