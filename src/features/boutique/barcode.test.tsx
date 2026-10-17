// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import { validateProductDraft, type ProductDraft } from '../../lib/store/products'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import LabelsPage, { BarcodeSvg } from './LabelsPage'
import PosPage from './PosPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function context(role: EffectiveRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role: 'viewer', isHardware: true },
    can: permissionsFor(role),
    staffRole: role,
  }
  return { fake, ctx }
}

const marteau = { id: 'p-1', name: 'Marteau', sku: 'MAR-1', barcode: '4006381333931', price: 5000, currency_code: 'XOF', track_inventory: true }
const sellUnit: FakeResult = { data: [{ id: 'su', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] }
const posLoad: FakeResult[] = [
  { data: null, count: 0 },
  { data: { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 0, opened_at: '2026-10-17T08:00:00Z', opened_by: 'u-1' } },
  { data: [{ id: 'unit-u', code: 'u', label: 'Pièce', dimension: 'count', decimal_places: 0 }] },
  { data: { settings: {} } },
  { data: [] },
]

describe('scan à la caisse', () => {
  it('douchette USB : code + Entrée ajoute le produit tout de suite, sans attendre la recherche', async () => {
    const { fake, ctx } = context('cashier', [...posLoad, { data: [marteau] }, sellUnit, { data: [] }])
    render(<PosPage ctx={ctx} />)
    const input = await screen.findByLabelText('Rechercher un produit ou scanner un code-barres')
    fireEvent.change(input, { target: { value: ' 4006381333931\r' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await within(await screen.findByRole('table', { name: 'Panier' })).findByText('Marteau')).toBeTruthy()
    const search = fake.queries.find((q) => q.table === 'products')!
    expect(fake.op(search, 'or')?.[0]).toContain('barcode.eq.4006381333931')
  })

  it('code inconnu : message clair, panier inchangé', async () => {
    const { ctx } = context('cashier', [...posLoad, { data: [] }])
    render(<PosPage ctx={ctx} />)
    const input = await screen.findByLabelText('Rechercher un produit ou scanner un code-barres')
    fireEvent.change(input, { target: { value: '0000000000000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Aucun produit actif pour le code « 0000000000000 ».')).toBeTruthy()
    expect(screen.getByText('Panier vide')).toBeTruthy()
  })

  it('caméra : bouton absent quand le navigateur ne fournit pas BarcodeDetector (jsdom)', async () => {
    const { ctx } = context('cashier', posLoad)
    render(<PosPage ctx={ctx} />)
    await screen.findByLabelText('Rechercher un produit ou scanner un code-barres')
    expect(screen.queryByRole('button', { name: 'Scanner avec la caméra' })).toBeNull()
  })
})

describe('fiche produit', () => {
  const draft = (barcode: string): ProductDraft => ({
    name: 'Marteau', sku: '', barcode, categoryId: null, status: 'active', price: '5000', description: '', trackInventory: true,
    attributes: {}, sellUnits: [{ unit_id: 'u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }], tiers: [], compatibilities: [],
    service: { warranty_duration_days: null, warranty_terms: null, return_window_days: null },
  })
  it('refuse un EAN à clé fausse, accepte un code interne', () => {
    expect(validateProductDraft(draft('4006381333932'))).toBe('Clé de contrôle EAN/UPC incorrecte : vérifiez le code.')
    expect(validateProductDraft(draft('4006381333931'))).toBeNull()
    expect(validateProductDraft(draft('MAR-500'))).toBeNull()
    expect(validateProductDraft(draft(''))).toBeNull()
  })
})

describe('étiquettes', () => {
  it('code-barres SVG : EAN-13 si valide, sinon Code 128', () => {
    render(<><BarcodeSvg code="4006381333931" /><BarcodeSvg code="MAR-1" /></>)
    expect(screen.getByRole('img', { name: 'EAN-13 4006381333931' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Code 128 MAR-1' })).toBeTruthy()
  })

  it('sélection, exemplaires et impression d’une planche', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { ctx } = context('owner', [{ data: [marteau] }, sellUnit, { data: [] }])
    render(<LabelsPage ctx={ctx} />)
    fireEvent.change(screen.getByLabelText('Produit à étiqueter'), { target: { value: 'Mar' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }))
    fireEvent.change(screen.getByLabelText('Exemplaires de Marteau'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Imprimer 3 étiquettes' }))
    expect(await screen.findAllByRole('article', { name: 'Étiquette Marteau', hidden: true })).toHaveLength(3)
    await vi.waitFor(() => expect(print).toHaveBeenCalled())
    print.mockRestore()
  })
})
