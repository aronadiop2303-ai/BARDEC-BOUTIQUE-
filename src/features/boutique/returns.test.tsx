// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { ReceiptSnapshot } from '../../domain/pos/receipt'
import type { BoutiqueContext } from './context'
import PosPage from './PosPage'
import Receipt from './Receipt'

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
  render(<PosPage ctx={ctx} />)
  return fake
}

const receiptSnapshot: ReceiptSnapshot = {
  version: 1,
  document: { type: 'receipt', number: 'TICKET-2026-000050', issued_at: '2026-10-17T09:00:00Z' },
  shop: { name: 'Quincaillerie Diop' }, settings: {}, cashier: { name: 'Awa' }, customer: null,
  lines: [{ name: 'Marteau', quantity: 3, unit_label: 'Pièce', unit_price: 5000, line_discount: 0, line_total: 15000 }],
  totals: { subtotal: 15000, discount_total: 0, tax_total: 0, grand_total: 15000, currency: 'XOF' },
  payments: [{ method: 'cash', label: 'Espèces', amount: 15000 }], cash: { tendered: 15000, change: 0 },
}
const creditSnapshot: ReceiptSnapshot = {
  ...receiptSnapshot,
  document: { type: 'credit_note', number: 'AVOIR-2026-000001', issued_at: '2026-10-17T10:00:00Z', original_number: 'TICKET-2026-000050' },
  lines: [{ name: 'Marteau', quantity: 1, unit_label: 'Pièce', unit_price: 5000, line_discount: 0, line_total: 5000, disposition: 'damage' }],
  totals: { subtotal: 5000, discount_total: 0, tax_total: 0, grand_total: 5000, currency: 'XOF' },
  payments: [{ method: 'cash', label: 'Remboursement espèces', amount: 5000 }], cash: { tendered: 0, change: 0 },
  return: { reason: 'Manche cassé', original_number: 'TICKET-2026-000050' },
}

const installed: FakeResult = { data: null, count: 0 }
const session: FakeResult = { data: { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 0, opened_at: '2026-10-17T08:00:00Z', opened_by: 'u-1' } }
const units: FakeResult = { data: [] }
const settings: FakeResult = { data: { settings: { pos: { cashier_max_return_amount: 6000 } } } }
const receiptRow = { id: 'doc-1', document_type: 'receipt', order_id: 'order-1', document_number: 'TICKET-2026-000050', status: 'issued', total_amount: 15000, issued_at: '2026-10-17T09:00:00Z', void_reason: null, content_snapshot: receiptSnapshot }
const returnable: FakeResult = {
  data: [{ order_item_id: 'item-1', product_id: 'p-1', product_name: 'Marteau', unit_label: 'Pièce', decimal_places: 0, quantity_sold: 3, quantity_returned: 0, quantity_returnable: 3, unit_refund: 5000 }],
}

describe('retours partiels', () => {
  it('vendeur : quantité limitée, plafond, avoir imprimé après validation par la base', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const fake = setup('cashier', [
      installed, session, units, settings, { data: [receiptRow] }, returnable,
      { data: { return_id: 'r-1', document_number: 'AVOIR-2026-000001', refund_amount: 5000, refund_method: 'cash', snapshot: creditSnapshot } },
      { data: [receiptRow, { ...receiptRow, id: 'doc-2', document_type: 'credit_note', document_number: 'AVOIR-2026-000001', total_amount: 5000, content_snapshot: creditSnapshot }] },
    ])
    const row = (await screen.findByText('TICKET-2026-000050')).closest('tr') as HTMLElement
    expect(within(row).queryByRole('button', { name: 'Annuler' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Retour' }))
    const form = await screen.findByRole('group', { name: 'Retour sur TICKET-2026-000050' })
    fireEvent.change(within(form).getByLabelText('Quantité retournée de Marteau'), { target: { value: '4' } })
    expect(within(form).getByText(/au plus 3 à retourner/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Quantité retournée de Marteau'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('Motif du retour'), { target: { value: 'Manche cassé' } })
    expect(within(form).getByText(/plafond autorisé pour un vendeur \(6000\)/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Quantité retournée de Marteau'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Destination de Marteau'), { target: { value: 'damage' } })
    fireEvent.click(within(form).getByRole('button', { name: /Valider le retour/ }))

    expect(await screen.findByText(/Avoir AVOIR-2026-000001 : 5 000 FCFA remboursé/)).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:record_return')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({
      p_site_id: SITE, p_order_id: 'order-1', p_lines: [{ order_item_id: 'item-1', quantity: 1, disposition: 'damage' }],
      p_reason: 'Manche cassé', p_refund_method: 'cash', p_cash_session_id: 'sess-1',
    })
    const ticket = await screen.findByRole('article', { name: 'Avoir AVOIR-2026-000001', hidden: true })
    expect(ticket.textContent).toContain('TICKET-2026-000050')
    expect(ticket.textContent).toContain('Casse (non remis en stock)')
    expect(ticket.textContent).toContain('TOTAL REMBOURSÉ5 000 FCFA')
    expect(await within(screen.getByRole('table', { name: 'Ventes' })).findByText('AVOIR-2026-000001')).toBeTruthy()
    print.mockRestore()
  }, 20000)

  it('gérant : une vente qui a un avoir ne propose plus « Annuler »', async () => {
    setup('manager', [installed, session, units, settings, {
      data: [
        { ...receiptRow, id: 'doc-2', document_type: 'credit_note', document_number: 'AVOIR-2026-000001', total_amount: 5000, content_snapshot: creditSnapshot },
        receiptRow,
        { ...receiptRow, id: 'doc-3', order_id: 'order-2', document_number: 'TICKET-2026-000051' },
      ],
    }])
    const withReturn = (await screen.findByText('TICKET-2026-000050')).closest('tr') as HTMLElement
    expect(within(withReturn).queryByRole('button', { name: 'Annuler' })).toBeNull()
    expect(within(withReturn).getByRole('button', { name: 'Retour' })).toBeTruthy()
    const other = screen.getByText('TICKET-2026-000051').closest('tr') as HTMLElement
    expect(within(other).getByRole('button', { name: 'Annuler' })).toBeTruthy()
    const credit = screen.getByText('AVOIR-2026-000001').closest('tr') as HTMLElement
    expect(credit.textContent).toContain('−5 000 FCFA')
    expect(within(credit).queryByRole('button', { name: 'Retour' })).toBeNull()
  })

  it('magasinier ou lecture seule : pas de bouton Retour', async () => {
    setup('viewer', [installed, session, units, settings, { data: [receiptRow] }])
    const row = (await screen.findByText('TICKET-2026-000050')).closest('tr') as HTMLElement
    expect(within(row).queryByRole('button', { name: 'Retour' })).toBeNull()
  })

  it('l’avoir réimprimé affiche ANNULÉ seulement s’il est annulé, jamais de TVA', () => {
    render(<Receipt snapshot={creditSnapshot} format="a4" />)
    const text = screen.getByRole('article').textContent ?? ''
    expect(text).toContain('Avoir')
    expect(text).toContain('Manche cassé')
    expect(text).not.toMatch(/ANNULÉ|TVA/)
  })
})
