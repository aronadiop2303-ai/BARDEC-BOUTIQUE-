// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import PurchasesPage from './PurchasesPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: EffectiveRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role: 'viewer', isHardware: true },
    can: permissionsFor(role),
    staffRole: role,
  }
  render(<PurchasesPage ctx={ctx} />)
  return fake
}

const receivableOrders: FakeResult = { data: [{ purchase_order_id: 'po-1', number: 'BC-2026-000001', supplier_name: 'Sococim', status: 'ordered', created_at: '2026-10-17T08:00:00Z' }] }
const locations: FakeResult = { data: [{ id: 'loc-1', name: 'Magasin', location_type: 'store', address: null, is_active: true }] }
const receivableLines: FakeResult = { data: [{ line_id: 'l-1', product_id: 'p-1', product_name: 'Ciment 50 kg', unit_label: 'Sac', decimal_places: 0, quantity_ordered: 40, quantity_received: 0, quantity_remaining: 40 }] }
const suppliers: FakeResult = { data: [{ id: 's-1', name: 'Sococim', phone: null, address: null, notes: null, is_active: true }] }

describe('fournisseurs et achats', () => {
  it('magasinier : réception seulement, sans aucun prix ni montant', async () => {
    const fake = setup('stock_keeper', [receivableOrders, locations, receivableLines, { data: { receipt_id: 'r-1', purchase_order_id: 'po-1', lines_received: 1, status: 'partially_received' } }, { data: [] }, locations])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Réception'])
    fireEvent.click(await screen.findByRole('button', { name: 'Réceptionner' }))
    const form = await screen.findByRole('group', { name: 'Réception de BC-2026-000001' })
    expect(form.textContent).not.toMatch(/FCFA|coût|prix/i)
    fireEvent.change(within(form).getByLabelText('Quantité reçue de Ciment 50 kg'), { target: { value: '41' } })
    expect(within(form).getByText('« Ciment 50 kg » : au plus 40 restant à recevoir.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Quantité reçue de Ciment 50 kg'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer la réception' }))
    expect(await screen.findByText(/Réception enregistrée sur BC-2026-000001 : 1 ligne\(s\)/)).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:receive_purchase')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_purchase_order_id: 'po-1', p_lines: [{ line_id: 'l-1', quantity: 30, location_id: 'loc-1' }], p_note: null })
    // Aucune lecture des tables portant des coûts.
    expect(fake.queries.some((q) => ['purchase_orders', 'purchase_order_lines', 'supplier_ledger'].includes(q.table))).toBe(false)
    expect(document.body.textContent).not.toMatch(/FCFA/)
  })

  it('gérant : création d’un bon avec coûts d’achat', async () => {
    const fake = setup('manager', [
      { data: [] }, suppliers,
      { data: [{ id: 'p-1', name: 'Ciment 50 kg' }] },
      { data: { purchase_order_id: 'po-2', number: 'BC-2026-000002', total_amount: 176000 } },
      { data: [] }, suppliers,
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Nouveau bon de commande/ }))
    fireEvent.change(screen.getByLabelText('Ajouter un produit au bon'), { target: { value: 'Cim' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }))
    fireEvent.change(screen.getByLabelText('Quantité commandée de Ciment 50 kg'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Coût d’achat de Ciment 50 kg'), { target: { value: '4 400' } })
    expect(screen.getByText(/Total indicatif : 176 000 FCFA/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Créer le bon de commande' }))
    expect(await screen.findByText('Bon BC-2026-000002 créé : 176 000 FCFA.')).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:create_purchase_order')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_supplier_id: 's-1', p_lines: [{ product_id: 'p-1', quantity: 40, unit_cost: 4400 }], p_note: null })
  })

  it('gérant : dette fournisseur et règlement par virement', async () => {
    const fake = setup('manager', [{ data: [] }, suppliers, { data: [{ supplier_id: 's-1', name: 'Sococim', phone: null, balance: 132000, purchases_total: 132000, payments_total: 0 }] },
      { data: { entry_id: 'e-1', balance: 32000 } }, { data: [] }])
    await screen.findByRole('button', { name: /Nouveau bon de commande/ })
    fireEvent.click(screen.getByRole('tab', { name: 'Dettes fournisseurs' }))
    const table = await screen.findByRole('table', { name: 'Soldes fournisseurs' })
    expect(within(table).getAllByText('132 000 FCFA')).toHaveLength(2)
    fireEvent.click(within(table).getByRole('button', { name: 'Régler' }))
    fireEvent.change(screen.getByLabelText('Montant du règlement à Sococim'), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('Moyen de règlement'), { target: { value: 'bank_transfer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
    expect(await screen.findByText('Règlement enregistré. Reste dû : 32 000 FCFA.')).toBeTruthy()
    expect(fake.op(fake.queries.find((q) => q.table === 'rpc:record_supplier_payment')!, 'rpc')?.[0]).toMatchObject({ p_amount: 100000, p_method: 'bank_transfer', p_cash_session_id: null })
  })
})
