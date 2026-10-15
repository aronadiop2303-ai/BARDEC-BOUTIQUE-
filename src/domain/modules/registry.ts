import { MODULE_CATALOG } from './catalog'
import { ROLE_PERMISSIONS } from './permissions'
import { DEPRECATED_TABLES, VERIFIED_TABLES } from './tables'
import type { ModuleManifest, ModuleStatus, NavEntry, StoreRole } from './types'

/** Même contrainte que module_catalog_key_check en base. */
export const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

type Catalog = readonly ModuleManifest[]

function indexOf(catalog: Catalog): Map<string, ModuleManifest> {
  return new Map(catalog.map((module) => [module.key, module]))
}

// ── Dépendances ──────────────────────────────────────────────────────────────

export type ResolveResult =
  | { ok: true; order: string[] }
  | { ok: false; error: 'unknown'; key: string }
  | { ok: false; error: 'cycle'; cycle: string[] }

/**
 * Ferme transitivement les dépendances de `keys` et les ordonne : chaque module après ses dépendances.
 * Refuse un module inconnu et tout cycle (le cycle est rendu sous la forme a → b → a).
 */
export function resolveDependencies(keys: readonly string[], catalog: Catalog = MODULE_CATALOG): ResolveResult {
  const byKey = indexOf(catalog)
  const order: string[] = []
  const done = new Set<string>()
  const stack: string[] = []

  function visit(key: string): ResolveResult | null {
    if (done.has(key)) return null
    const onStack = stack.indexOf(key)
    if (onStack >= 0) return { ok: false, error: 'cycle', cycle: [...stack.slice(onStack), key] }
    const module = byKey.get(key)
    if (!module) return { ok: false, error: 'unknown', key }
    stack.push(key)
    for (const dependency of module.dependsOn) {
      const failure = visit(dependency)
      if (failure) return failure
    }
    stack.pop()
    done.add(key)
    order.push(key)
    return null
  }

  for (const key of keys) {
    const failure = visit(key)
    if (failure) return failure
  }
  return { ok: true, order }
}

// ── Activation ───────────────────────────────────────────────────────────────

export type ActivationCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown'; key: string }
  | { ok: false; reason: 'soon' }
  | { ok: false; reason: 'cycle'; cycle: string[] }
  | { ok: false; reason: 'missing-dependencies'; missing: string[] }

/**
 * Un module est activable s'il existe, est livré ('available'), n'est pris dans aucun cycle
 * et si toutes ses dépendances, directes et indirectes, sont déjà actives.
 * Contrôle d'affichage : l'activation réelle devra aussi être vérifiée par la base.
 */
export function canActivate(key: string, activeKeys: readonly string[], catalog: Catalog = MODULE_CATALOG): ActivationCheck {
  const module = indexOf(catalog).get(key)
  if (!module) return { ok: false, reason: 'unknown', key }
  if (module.status !== 'available') return { ok: false, reason: 'soon' }
  const resolved = resolveDependencies([key], catalog)
  if (!resolved.ok) {
    return resolved.error === 'cycle'
      ? { ok: false, reason: 'cycle', cycle: resolved.cycle }
      : { ok: false, reason: 'missing-dependencies', missing: [resolved.key] }
  }
  const active = new Set(activeKeys)
  const missing = resolved.order.filter((dependency) => dependency !== key && !active.has(dependency))
  return missing.length > 0 ? { ok: false, reason: 'missing-dependencies', missing } : { ok: true }
}

// ── Navigation ───────────────────────────────────────────────────────────────

export type NavItem = {
  id: string
  label: string
  moduleKey: string
  status: ModuleStatus
  note?: string
  children: NavItem[]
}

/**
 * Menu des modules actifs, livrés, dont les dépendances sont actives et que le rôle peut voir.
 * Les entrées 'soon' restent présentes (affichées inactives) ; celles dont le rôle n'a pas la permission disparaissent.
 */
export function buildNavigation(activeKeys: readonly string[], role: StoreRole, catalog: Catalog = MODULE_CATALOG): NavItem[] {
  const granted = new Set(ROLE_PERMISSIONS[role])
  const active = new Set(activeKeys)

  function toItems(entries: readonly NavEntry[], moduleKey: string, inherited: ModuleStatus): NavItem[] {
    return entries
      .filter((entry) => !entry.permission || granted.has(entry.permission))
      .map((entry) => {
        const status = entry.status ?? inherited
        return {
          id: entry.id,
          label: entry.label,
          moduleKey,
          status,
          ...(entry.note ? { note: entry.note } : {}),
          children: toItems(entry.children ?? [], moduleKey, status),
        }
      })
  }

  return catalog
    .filter((module) => active.has(module.key))
    .filter((module) => canActivate(module.key, activeKeys, catalog).ok)
    .filter((module) => module.requiredPermissions.every((permission) => granted.has(permission)))
    .flatMap((module) => toItems(module.navigation, module.key, module.status))
}

// ── Validation du catalogue ──────────────────────────────────────────────────

export type CatalogIssue = { code: string; moduleKey: string; detail: string }

function walk(entries: readonly NavEntry[], visit: (entry: NavEntry) => void) {
  for (const entry of entries) {
    visit(entry)
    walk(entry.children ?? [], visit)
  }
}

/**
 * Contrôle de cohérence du catalogue. Liste vide = catalogue valide.
 * Un module livré ne doit dépendre que de modules livrés et de tables vérifiées en base ;
 * aucun module ne doit dépendre d'une table écartée (dettes connues).
 */
export function validateCatalog(catalog: Catalog = MODULE_CATALOG, verifiedTables: readonly string[] = VERIFIED_TABLES): CatalogIssue[] {
  const issues: CatalogIssue[] = []
  const add = (code: string, moduleKey: string, detail: string) => issues.push({ code, moduleKey, detail })
  const byKey = indexOf(catalog)
  const verified = new Set(verifiedTables)
  const deprecated = new Set<string>(DEPRECATED_TABLES)
  const seenKeys = new Set<string>()
  const navOwner = new Map<string, string>()
  const cycles = new Set<string>()

  for (const module of catalog) {
    if (seenKeys.has(module.key)) add('duplicate-key', module.key, `Clé « ${module.key} » déclarée plusieurs fois.`)
    seenKeys.add(module.key)
    if (!MODULE_KEY_PATTERN.test(module.key)) add('invalid-key', module.key, 'La clé doit respecter ^[a-z][a-z0-9_]*$.')
    if (module.requiredPermissions.length === 0) add('missing-permissions', module.key, 'Aucune permission requise déclarée.')
    if (module.navigation.length === 0) add('empty-navigation', module.key, 'Aucune entrée de navigation.')

    for (const dependency of module.dependsOn) {
      const target = byKey.get(dependency)
      if (dependency === module.key) add('self-dependency', module.key, 'Le module dépend de lui-même.')
      else if (!target) add('unknown-dependency', module.key, `Dépendance inconnue : ${dependency}.`)
      else if (module.status === 'available' && target.status !== 'available') {
        add('available-depends-on-soon', module.key, `Module livré dépendant d'un module non livré : ${dependency}.`)
      }
    }

    for (const table of module.requiredTables) {
      if (deprecated.has(table)) add('deprecated-table', module.key, `Table écartée : ${table}.`)
      else if (module.status === 'available' && !verified.has(table)) add('unverified-table', module.key, `Table absente de la base vérifiée : ${table}.`)
    }

    walk(module.navigation, (entry) => {
      const owner = navOwner.get(entry.id)
      if (owner) add('duplicate-nav-id', module.key, `Entrée « ${entry.id} » déjà déclarée par ${owner}.`)
      else navOwner.set(entry.id, module.key)
      if (module.status === 'soon' && entry.status === 'available') add('available-entry-in-soon-module', module.key, `Entrée livrée dans un module non livré : ${entry.id}.`)
    })

    const settingKeys = new Set<string>()
    for (const field of module.settingsSchema ?? []) {
      if (settingKeys.has(field.key)) add('duplicate-setting', module.key, `Réglage « ${field.key} » déclaré plusieurs fois.`)
      settingKeys.add(field.key)
    }

    const resolved = resolveDependencies([module.key], catalog)
    if (!resolved.ok && resolved.error === 'cycle') {
      const signature = [...new Set(resolved.cycle)].sort().join(',')
      if (!cycles.has(signature)) {
        cycles.add(signature)
        add('cycle', module.key, `Cycle de dépendances : ${resolved.cycle.join(' → ')}.`)
      }
    }
  }
  return issues
}

/** Tables requises par un module et absentes de la base vérifiée : ce qui reste à créer. */
export function missingTables(module: ModuleManifest, verifiedTables: readonly string[] = VERIFIED_TABLES): string[] {
  const verified = new Set(verifiedTables)
  return module.requiredTables.filter((table) => !verified.has(table))
}
