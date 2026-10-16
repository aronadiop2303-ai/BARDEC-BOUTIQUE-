// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { StoreRole } from '../../lib/store/access'
import type { BoutiqueContext } from './context'
import StockPage, { STOCK_UNAVAILABLE } from './StockPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: StoreRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role, isHardware: true },
    can: permissionsFor(role),
  }
  render(<StockPage ctx={ctx} />)
  return fake
}

const locations: FakeResult = { data: [{ id: 'loc-1', name: 'Magasin', location_type: 'store', address: null, is_active: true }, { id: 'loc-2', name: 'Dépôt', location_type: 'warehouse', address: null, is_active: true }] }
const units: FakeResult = { data: [{ id: 'kg', code: 'kg', label: 'Kilogramme', dimension: 'mass', decimal_places: 3 }, { id: 'sac', code: 'sac', label: 'Sac', dimension: 'count', decimal_places: 0 }] }
const noProducts: FakeResult = { data: [], count: 0 }
const cimentRow = { id: 'p-1', category_id: null, name: 'Ciment', slug: 'ciment', status: 'active', price: 100, currency_code: 'XOF', sku: null, barcode: null, track_inventory: true, updated_at: '2026-10-16' }
const products: FakeResult = { data: [cimentRow], count: 1 }
const levels: FakeResult = { data: [{ product_id: 'p-1', stock_location_id: 'loc-1', quantity_delta: 100 }] }
const versionOk: FakeResult = { data: 1 }

describe('écran Stock', () => {
  it('affiche « Disponible après la mise à jour de la base » si la fonction est absente, sans formulaire', async () => {
    setup('owner', [locations, units, noProducts, { error: { code: 'PGRST202', message: 'Could not find the function public.stock_entries_version' } }])
    expect(await screen.findByText(new RegExp(STOCK_UNAVAILABLE))).toBeTruthy()
    for (const label of ['Entrée de stock', 'Inventaire initial', 'Ajustement']) {
      expect((screen.getByRole('button', { name: new RegExp(label) }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.queryByRole('region', { name: 'Mouvement de stock' })).toBeNull()
  })

  it('n’affiche aucun bouton de saisie à un vendeur', async () => {
    const fake = setup('editor', [locations, units, noProducts])
    expect(await screen.findByText(/Consultation seule/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Entrée de stock/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ajustement/ })).toBeNull()
    expect(fake.queries.some((q) => q.table === 'rpc:stock_entries_version')).toBe(false)
  })

  it('enregistre une entrée fractionnaire par record_stock_movement', async () => {
    const fake = setup('owner', [
      locations, units, products, versionOk, levels,
      // recherche du produit : produits, unités de vente, paliers
      { data: [{ id: 'p-1', name: 'Ciment', sku: null, barcode: null, price: 100, currency_code: 'XOF', track_inventory: true }] },
      { data: [
        { id: 'su-kg', product_id: 'p-1', unit_id: 'kg', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 },
        { id: 'su-sac', product_id: 'p-1', unit_id: 'sac', conversion_to_base: 50, is_default: false, min_sale_quantity: 1, quantity_step: 1 },
      ] },
      { data: [] },
      levels,
      { data: { movement_id: 'm-1', quantity_delta: 12.5, stock_before: 100, stock_after: 112.5, unit_label: 'Kilogramme' } },
      locations, units, products, { data: [{ product_id: 'p-1', stock_location_id: 'loc-1', quantity_delta: 112.5 }] },
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Entrée de stock/ }))
    fireEvent.change(await screen.findByLabelText('Rechercher le produit'), { target: { value: 'Cim' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }))
    expect(await screen.findByText(/Stock actuel à cet emplacement : 100 Kilogramme/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Quantité du mouvement'), { target: { value: '12,5' } })
    expect(screen.getByLabelText('Aperçu du stock').textContent).toContain('112,5 Kilogramme')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mouvement' }))
    expect(await screen.findByText(/Entrée de stock enregistré : Ciment, Magasin\. Stock : 100 → 112,5 Kilogramme/)).toBeTruthy()

    const call = fake.queries.find((q) => q.table === 'rpc:record_stock_movement')
    expect(fake.op(call!, 'rpc')?.[0]).toEqual({
      p_site_id: SITE, p_product_id: 'p-1', p_location_id: 'loc-1', p_movement_type: 'restock', p_quantity: 12.5, p_unit_id: 'kg', p_reason: null,
    })
  })

  it('exige un motif pour un ajustement et refuse un sac fractionnaire', async () => {
    setup('admin', [
      locations, units, products, versionOk, levels,
      { data: [{ id: 'p-1', name: 'Ciment', sku: null, barcode: null, price: 100, currency_code: 'XOF', track_inventory: true }] },
      { data: [
        { id: 'su-kg', product_id: 'p-1', unit_id: 'kg', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 },
        { id: 'su-sac', product_id: 'p-1', unit_id: 'sac', conversion_to_base: 50, is_default: false, min_sale_quantity: 1, quantity_step: 1 },
      ] },
      { data: [] },
      levels,
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Ajustement/ }))
    fireEvent.change(await screen.findByLabelText('Rechercher le produit'), { target: { value: 'Cim' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }))
    await screen.findByText(/Stock actuel/)
    fireEvent.change(screen.getByLabelText('Quantité du mouvement'), { target: { value: '-2' } })
    expect(screen.getByText('Le motif est obligatoire (3 caractères au moins).')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer le mouvement' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Unité du mouvement'), { target: { value: 'sac' } })
    fireEvent.change(screen.getByLabelText('Quantité du mouvement'), { target: { value: '1,5' } })
    fireEvent.change(screen.getByLabelText('Motif du mouvement'), { target: { value: 'Comptage' } })
    expect(screen.getByText('L’unité « Sac » se compte uniquement en nombre entier.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Quantité du mouvement'), { target: { value: '-1' } })
    expect(screen.getByLabelText('Aperçu du stock').textContent).toContain('après le mouvement : 50 Kilogramme')
    expect((screen.getByRole('button', { name: 'Enregistrer le mouvement' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('affiche l’historique des mouvements d’un produit', async () => {
    setup('viewer', [
      locations, units, products, levels,
      { data: [
        { id: 'm-2', movement_type: 'sale', quantity_delta: -2.5, unit_quantity: 2.5, unit_id: 'kg', stock_location_id: 'loc-1', reason: 'Vente comptoir', reference_type: 'order', created_at: '2026-10-16T10:00:00Z' },
        { id: 'm-1', movement_type: 'initial_stock', quantity_delta: 100, unit_quantity: 2, unit_id: 'sac', stock_location_id: 'loc-1', reason: null, reference_type: 'manual_entry', created_at: '2026-10-16T08:00:00Z' },
      ] },
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Historique de Ciment' }))
    const history = await screen.findByRole('region', { name: 'Historique de Ciment' })
    const text = history.textContent ?? ''
    expect(text).toContain('Inventaire initial')
    expect(text).toContain('2 Sac')
    expect(text).toContain('+100')
    expect(text).toContain('Vente')
    expect(text).toContain('-2,5')
  })
})
