import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '../../test/fakeSupabase'
import { loadStoreAccess } from './access'
import { buildFamilyTree, createFamily, familyWithDescendants, flattenFamilies, type Family } from './categories'
import { permissionsFor } from './permissions'
import { listProducts, sanitizeSearch, saveProduct, validateProductDraft, type ProductDetail, type ProductDraft } from './products'
import { getSetupStatus, runSetup, validateProfile } from './setup'
import { loadStockLevels } from './stock'

const SITE = '11111111-1111-4111-8111-111111111111'
const site = { id: SITE, workspace_id: 'ws-1', name: 'Quincaillerie Diop', slug: 'quincaillerie-diop', site_type: 'store', status: 'draft', category_id: 'cat-q' }

describe('garde d’accès', () => {
  it('reconnaît le propriétaire d’une quincaillerie', async () => {
    const fake = fakeSupabase([
      { data: site },
      { data: { id: 'ws-1', name: 'Mon espace', owner_id: 'u1' } },
      { data: { slug: 'quincaillerie' } },
    ])
    const result = await loadStoreAccess(fake.client, SITE, 'u1')
    expect(result).toMatchObject({ status: 'ok', access: { role: 'owner', isHardware: true } })
  })

  it('lit le rôle d’un membre et détecte le module hardware_building', async () => {
    const fake = fakeSupabase([
      { data: { ...site, category_id: null } },
      { data: { id: 'ws-1', name: 'Espace', owner_id: 'autre' } },
      { data: { role: 'editor' } },
      { data: [{ module_key: 'hardware_building' }] },
    ])
    expect(await loadStoreAccess(fake.client, SITE, 'u2')).toMatchObject({ status: 'ok', access: { role: 'editor', isHardware: true } })
  })

  it('refuse un site publié visible mais dont l’espace n’est pas accessible', async () => {
    const fake = fakeSupabase([{ data: { ...site, status: 'published' } }, { data: null }])
    expect(await loadStoreAccess(fake.client, SITE, 'intrus')).toEqual({ status: 'forbidden' })
  })

  it('renvoie « introuvable » pour un identifiant invalide sans interroger la base', async () => {
    const fake = fakeSupabase([])
    expect(await loadStoreAccess(fake.client, 'pas-un-uuid', 'u1')).toEqual({ status: 'not-found' })
    expect(fake.queries).toHaveLength(0)
  })

  it('applique la matrice : seuls propriétaire et admin configurent et modifient le catalogue', () => {
    expect(permissionsFor('owner')).toMatchObject({ configure: true, editCatalog: true, writeStock: false })
    expect(permissionsFor('admin')).toMatchObject({ configure: true, editCatalog: true })
    for (const role of ['editor', 'publisher', 'viewer'] as const) {
      expect(permissionsFor(role)).toMatchObject({ configure: false, editCatalog: false, archiveProducts: false, writeStock: false })
    }
  })
})

describe('configuration initiale', () => {
  const input = {
    profile: { public_name: 'Quincaillerie Diop', phone: '+221 77 000 00 00', whatsapp: '', address: '', city: 'Dakar', hours: 'Lun–Sam 8h–19h' },
    locations: ['magasin', 'depot'],
    families: ['plomberie', 'electricite'],
    units: ['piece', 'm', 'sac'],
  }

  it('écrit profil, emplacements, familles, unités, module et réglages', async () => {
    const fake = fakeSupabase([{}, { data: [] }, {}, {}, {}, {}, {}])
    await runSetup(fake.client, SITE, 'u1', input)
    expect(fake.queries.map((q) => q.table)).toEqual([
      'business_profiles', 'stock_locations', 'stock_locations', 'product_categories', 'product_units', 'site_commerce_modules', 'store_document_settings',
    ])
    const profile = fake.op(fake.queries[0], 'upsert')
    expect(profile?.[0]).toMatchObject({ site_id: SITE, public_name: 'Quincaillerie Diop', currency_code: 'XOF', whatsapp: null, opening_hours: { text: 'Lun–Sam 8h–19h' } })
    expect(profile?.[1]).toEqual({ onConflict: 'site_id' })
    expect((fake.op(fake.queries[2], 'insert')?.[0] as unknown[]).length).toBe(2)
    expect(fake.op(fake.queries[3], 'upsert')?.[1]).toEqual({ onConflict: 'site_id,slug', ignoreDuplicates: true })
    expect(fake.op(fake.queries[4], 'upsert')?.[1]).toEqual({ onConflict: 'site_id,code', ignoreDuplicates: true })
    expect(fake.op(fake.queries[5], 'upsert')?.[0]).toMatchObject({ module_key: 'hardware_building', is_enabled: true })
    expect(fake.op(fake.queries[6], 'upsert')?.[1]).toEqual({ onConflict: 'site_id', ignoreDuplicates: true })
  })

  it('est idempotente : une relance n’ajoute pas d’emplacement existant', async () => {
    const fake = fakeSupabase([{}, { data: [{ name: 'Magasin' }, { name: ' dépôt ' }] }, {}, {}, {}, {}])
    await runSetup(fake.client, SITE, 'u1', input)
    expect(fake.queries.filter((q) => fake.op(q, 'insert'))).toHaveLength(0)
    expect(fake.queries.some((q) => fake.op(q, 'delete'))).toBe(false)
  })

  it('refuse une configuration sans emplacement ou sans nom', async () => {
    await expect(runSetup(fakeSupabase([]).client, SITE, 'u1', { ...input, locations: [] })).rejects.toThrow('emplacement')
    expect(validateProfile({ ...input.profile, public_name: '  ' })).toContain('obligatoire')
    expect(validateProfile({ ...input.profile, phone: 'abc' })).toContain('téléphone')
  })

  it('indique si la boutique est configurée', async () => {
    const done = fakeSupabase([
      { data: { public_name: 'Q' } }, { data: [{ module_key: 'hardware_building', is_enabled: true }] }, { data: { id: 'd' } }, { data: [{ id: 'l' }] },
    ])
    expect((await getSetupStatus(done.client, SITE)).complete).toBe(true)
    const partial = fakeSupabase([{ data: { public_name: 'Q' } }, { data: [{ is_enabled: false }] }, { data: { id: 'd' } }, { data: [{ id: 'l' }] }])
    expect(await getSetupStatus(partial.client, SITE)).toMatchObject({ complete: false, moduleEnabled: false })
  })
})

describe('familles', () => {
  const rows: Family[] = [
    { id: 'p', parent_id: null, name: 'Plomberie', slug: 'plomberie', description: null, sort_order: 1, is_active: true },
    { id: 'e', parent_id: null, name: 'Électricité', slug: 'electricite', description: null, sort_order: 0, is_active: true },
    { id: 'pvc', parent_id: 'p', name: 'Tuyaux PVC', slug: 'tuyaux-pvc', description: null, sort_order: 0, is_active: true },
    { id: 'pvc32', parent_id: 'pvc', name: 'PVC 32', slug: 'pvc-32', description: null, sort_order: 0, is_active: true },
    { id: 'x', parent_id: 'y', name: 'Boucle X', slug: 'x', description: null, sort_order: 0, is_active: true },
    { id: 'y', parent_id: 'x', name: 'Boucle Y', slug: 'y', description: null, sort_order: 0, is_active: true },
  ]

  it('construit un arbre trié sans perdre de famille, même en cas de boucle', () => {
    const flat = flattenFamilies(buildFamilyTree(rows))
    expect(flat).toHaveLength(rows.length)
    expect(flat.slice(0, 4).map((n) => [n.name, n.depth])).toEqual([['Électricité', 0], ['Plomberie', 0], ['Tuyaux PVC', 1], ['PVC 32', 2]])
  })

  it('inclut les sous-familles dans le filtre', () => {
    expect(familyWithDescendants(rows, 'p').sort()).toEqual(['p', 'pvc', 'pvc32'])
  })

  it('crée une famille avec un slug, suffixé en cas de conflit', async () => {
    const fake = fakeSupabase([{ error: { code: '23505', message: 'duplicate' } }, { data: rows[0] }])
    await createFamily(fake.client, SITE, { name: 'Plomberie', parentId: null })
    expect((fake.op(fake.queries[0], 'insert')?.[0] as { slug: string }).slug).toBe('plomberie')
    expect((fake.op(fake.queries[1], 'insert')?.[0] as { slug: string }).slug).toMatch(/^plomberie-[a-z0-9]{4}$/)
  })
})

describe('produits', () => {
  it('pagine côté serveur et filtre statut, familles et recherche', async () => {
    const fake = fakeSupabase([{ data: [], count: 42 }])
    const result = await listProducts(fake.client, SITE, { search: 'ciment, (CPJ)', categoryIds: ['a', 'b'], page: 2, pageSize: 10 })
    expect(result.total).toBe(42)
    const query = fake.queries[0]
    expect(fake.op(query, 'in')).toEqual(['status', ['draft', 'active']])
    expect(query.ops.filter(([n]) => n === 'in')[1][1]).toEqual(['category_id', ['a', 'b']])
    expect(fake.op(query, 'or')).toEqual(['name.ilike.*ciment CPJ*,sku.ilike.*ciment CPJ*,barcode.eq.ciment CPJ'])
    expect(fake.op(query, 'range')).toEqual([20, 29])
  })

  it('neutralise la syntaxe de filtre dans la recherche', () => {
    expect(sanitizeSearch('a,b.or(c)*%')).toBe('a b or c')
  })

  const draft: ProductDraft = {
    name: 'Ciment CPJ 45', sku: 'CIM-45', barcode: '', categoryId: 'go', status: 'active', price: '100',
    description: '', trackInventory: true, attributes: { brand: ' SOCOCIM ', color: '' },
    sellUnits: [
      { unit_id: 'kg', conversion_to_base: 1, min_sale_quantity: 1, quantity_step: 1, is_default: false },
      { unit_id: 'sac', conversion_to_base: 50, min_sale_quantity: 1, quantity_step: 1, is_default: true },
    ],
    tiers: [{ unit_id: 'sac', min_quantity: 10, unit_price: 4600, valid_from: null, valid_until: null }],
    compatibilities: [],
    service: { warranty_duration_days: null, warranty_terms: null, return_window_days: null },
  }

  it('valide la fiche : unité de base unique, paliers cohérents, prix entier', () => {
    expect(validateProductDraft(draft)).toBeNull()
    expect(validateProductDraft({ ...draft, price: '99,5' })).toContain('Prix')
    expect(validateProductDraft({ ...draft, sellUnits: [] })).toContain('unité de vente')
    expect(validateProductDraft({ ...draft, sellUnits: [draft.sellUnits[1]] })).toContain('unité de base')
    expect(validateProductDraft({ ...draft, tiers: [{ ...draft.tiers[0], unit_id: 'tonne' }] })).toContain('pas une unité de vente')
    expect(validateProductDraft({ ...draft, tiers: [draft.tiers[0], { ...draft.tiers[0] }] })).toContain('même quantité')
  })

  it('crée le produit puis ses unités et paliers, sans attribut vide', async () => {
    const fake = fakeSupabase([{ data: { id: 'prod-1' } }, {}, {}])
    expect(await saveProduct(fake.client, SITE, draft, null)).toBe('prod-1')
    const product = fake.op(fake.queries[0], 'insert')?.[0] as Record<string, unknown>
    expect(product).toMatchObject({ site_id: SITE, name: 'Ciment CPJ 45', slug: 'ciment-cpj-45', price: 100, sku: 'CIM-45', barcode: null, attributes: { brand: 'SOCOCIM' } })
    expect(fake.queries.map((q) => q.table)).toEqual(['products', 'product_sell_units', 'price_tiers'])
    expect((fake.op(fake.queries[1], 'insert')?.[0] as unknown[]).length).toBe(2)
  })

  it('traduit un doublon de référence sans réessayer', async () => {
    const fake = fakeSupabase([{ error: { code: '23505', message: 'duplicate key value violates unique constraint "products_site_id_sku_key"' } }])
    await expect(saveProduct(fake.client, SITE, draft, null)).rejects.toThrow('référence (SKU)')
    expect(fake.queries).toHaveLength(1)
  })

  it('en modification : supprime les lignes retirées, met à jour et ajoute les autres', async () => {
    const original = {
      id: 'prod-1', sellUnits: [{ ...draft.sellUnits[0], id: 'su-kg' }, { ...draft.sellUnits[1], id: 'su-old' }],
      tiers: [{ ...draft.tiers[0], id: 't-1' }], compatibilities: [], service: null,
    } as unknown as ProductDetail
    const edited: ProductDraft = {
      ...draft,
      sellUnits: [{ ...draft.sellUnits[0], id: 'su-kg' }, { unit_id: 'tonne', conversion_to_base: 1000, min_sale_quantity: 1, quantity_step: 1, is_default: false }],
      tiers: [],
    }
    const fake = fakeSupabase([{}, {}, {}, {}, {}])
    await saveProduct(fake.client, SITE, edited, original)
    const ops = fake.queries.map((q) => `${q.table}:${q.ops[0][0]}`)
    expect(ops).toEqual(['products:update', 'product_sell_units:delete', 'product_sell_units:update', 'product_sell_units:insert', 'price_tiers:delete'])
    expect(fake.op(fake.queries[1], 'in')).toEqual(['id', ['su-old']])
    expect(fake.op(fake.queries[0], 'insert')).toBeUndefined()
  })
})

describe('stock', () => {
  it('agrège le registre des produits demandés', async () => {
    const fake = fakeSupabase([{ data: [
      { product_id: 'a', stock_location_id: 'm', quantity_delta: 10 },
      { product_id: 'a', stock_location_id: 'm', quantity_delta: -2.5 },
    ] }])
    const result = await loadStockLevels(fake.client, SITE, ['a'])
    expect(result).toEqual({ levels: [{ productId: 'a', locationId: 'm', quantity: 7.5 }], truncated: false })
    expect(fake.op(fake.queries[0], 'in')).toEqual(['product_id', ['a']])
    expect(fake.queries[0].ops.some(([n]) => n === 'insert' || n === 'update')).toBe(false)
  })

  it('ne fait aucune requête sans produit', async () => {
    const fake = fakeSupabase([])
    expect(await loadStockLevels(fake.client, SITE, [])).toEqual({ levels: [], truncated: false })
    expect(fake.queries).toHaveLength(0)
  })
})
