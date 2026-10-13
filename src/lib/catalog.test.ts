import { describe, expect, it } from 'vitest'
import { buildCategoryTree, formatCategoryPath, resolveSiteType, type SiteCategory } from './catalog'

const row = (overrides: Partial<SiteCategory> & Pick<SiteCategory, 'id' | 'name'>): SiteCategory => ({
  parent_id: null,
  level: 1,
  slug: overrides.id,
  description: null,
  default_site_type: null,
  sort_order: 0,
  ...overrides,
})

const rows: SiteCategory[] = [
  row({ id: 'quinc', name: 'Quincaillerie', level: 3, parent_id: 'magasin', default_site_type: 'store' }),
  row({ id: 'educ', name: 'Éducation', sort_order: 20, default_site_type: 'school' }),
  row({ id: 'commerce', name: 'Commerce', sort_order: 10, default_site_type: 'store' }),
  row({ id: 'magasin', name: 'Magasin', level: 2, parent_id: 'commerce' }),
]

describe('buildCategoryTree', () => {
  it('construit la hiérarchie secteur > sous-secteur > spécialité', () => {
    const tree = buildCategoryTree(rows)
    expect(tree.map((n) => n.name)).toEqual(['Commerce', 'Éducation'])
    expect(tree[0].children[0].name).toBe('Magasin')
    expect(tree[0].children[0].children[0].name).toBe('Quincaillerie')
  })

  it('trie par sort_order puis par nom (ordre français)', () => {
    const tree = buildCategoryTree([
      row({ id: 'b', name: 'Écoles', sort_order: 5 }),
      row({ id: 'a', name: 'Zèbre', sort_order: 5 }),
      row({ id: 'c', name: 'Alpha', sort_order: 9 }),
    ])
    expect(tree.map((n) => n.name)).toEqual(['Écoles', 'Zèbre', 'Alpha'])
  })

  it('ignore une ligne dont le parent est absent (parent inactif masqué par RLS)', () => {
    const tree = buildCategoryTree([row({ id: 'orphan', name: 'Orpheline', level: 2, parent_id: 'inconnu' })])
    expect(tree).toEqual([])
  })

  it('ne modifie pas les lignes reçues', () => {
    const input = [row({ id: 'x', name: 'X' })]
    buildCategoryTree(input)
    expect(input[0]).not.toHaveProperty('children')
  })

  it('retourne un arbre vide pour une liste vide', () => {
    expect(buildCategoryTree([])).toEqual([])
  })
})

describe('formatCategoryPath', () => {
  it('assemble le chemin lisible', () => {
    const tree = buildCategoryTree(rows)
    const path = [tree[0], tree[0].children[0], tree[0].children[0].children[0]]
    expect(formatCategoryPath(path)).toBe('Commerce › Magasin › Quincaillerie')
  })
})

describe('resolveSiteType', () => {
  it('prend la famille de la catégorie la plus précise qui en déclare une', () => {
    const tree = buildCategoryTree(rows)
    const path = [tree[0], tree[0].children[0], tree[0].children[0].children[0]]
    expect(resolveSiteType(path)).toBe('store')
    expect(resolveSiteType([tree[0], tree[0].children[0]])).toBe('store')
  })

  it('retombe sur « business » sans catégorie', () => {
    expect(resolveSiteType([])).toBe('business')
  })
})
