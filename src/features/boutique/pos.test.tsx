// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { StoreRole } from '../../lib/store/access'
import type { ReceiptSnapshot } from '../../domain/pos/receipt'
import type { BoutiqueContext } from './context'
import PosPage, { MANUAL_PAYMENT_NOTICE } from './PosPage'
import Receipt from './Receipt'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: StoreRole, responses: FakeResult[], userId = 'u-1') {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId, siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role, isHardware: true },
    can: permissionsFor(role),
  }
  render(<PosPage ctx={ctx} />)
  return fake
}

/** Instantané figé VOLONTAIREMENT incohérent : 3 × 5 000 n'y vaut pas 999, et le total n'est pas la somme des lignes. */
const frozen: ReceiptSnapshot = {
  version: 1,
  document: { type: 'receipt', number: 'TICKET-2026-000042', issued_at: '2026-10-16T09:30:00Z' },
  shop: { name: 'Quincaillerie Diop', address: 'Route de Rufisque', city: 'Pikine', phone: '77 000 00 00' },
  settings: { paper: 'thermal_80mm', footer_text: 'Merci de votre visite', legal_details: { ninea: '0012345', vat_number: '' }, show_cashier_name: true, show_customer_details: false },
  cashier: { id: 'u-1', name: 'Awa' },
  customer: { name: 'Moussa', phone: '770000001' },
  lines: [{ name: 'Marteau', sku: 'MAR-1', quantity: 3, unit_label: 'Pièce', unit_price: 5000, line_discount: 0, line_total: 999 }],
  totals: { subtotal: 999, discount_total: 0, tax_total: 0, grand_total: 12345, currency: 'XOF' },
  payments: [{ method: 'cash', label: 'Espèces', amount: 12345, reference: null }],
  cash: { tendered: 20000, change: 7655 },
}

describe('impression depuis l’instantané', () => {
  it('affiche les valeurs figées sans rien recalculer', () => {
    render(<Receipt snapshot={frozen} format="ticket" />)
    const receipt = screen.getByRole('article', { name: 'Ticket de caisse TICKET-2026-000042' })
    const text = receipt.textContent ?? ''
    expect(text).toContain('999 FCFA')
    expect(text).toContain('12 345 FCFA')
    expect(text).not.toContain('15 000 FCFA')
    expect(text).toContain('3 Pièce × 5 000 FCFA')
    expect(text).toContain('Monnaie rendue7 655 FCFA')
    expect(text).toContain('Caissier')
    expect(text).toContain('NINEA : 0012345')
    expect(text).toContain('Merci de votre visite')
  })

  it('n’affiche la TVA que si elle est renseignée, masque le client selon les réglages, marque un reçu annulé', () => {
    const { unmount } = render(<Receipt snapshot={frozen} format="a4" voided />)
    const text = screen.getByRole('article').textContent ?? ''
    expect(text).not.toContain('TVA')
    expect(text).not.toContain('Moussa')
    expect(text).toContain('ANNULÉ')
    expect(text).toContain('Reçu de vente')
    unmount()
    render(<Receipt snapshot={{ ...frozen, settings: { ...frozen.settings, legal_details: { vat_number: 'SN-TVA-1' }, show_customer_details: true } }} format="a4" />)
    const withVat = screen.getByRole('article').textContent ?? ''
    expect(withVat).toContain('N° TVA : SN-TVA-1')
    expect(withVat).toContain('Moussa')
  })
})

describe('contenu du ticket', () => {
  it('montre désignation, quantité, unité, prix, remise, paiement, remis et rendu ; jamais de ligne TVA', () => {
    const withDiscount: ReceiptSnapshot = {
      ...frozen,
      lines: [{ name: 'Câble 2,5 mm²', sku: null, quantity: 12.5, unit_label: 'm', unit_price: 400, line_discount: 100, line_total: 4900 }],
      totals: { ...frozen.totals, tax_total: 999 },
    }
    render(<Receipt snapshot={withDiscount} format="ticket" />)
    const text = screen.getByRole('article').textContent ?? ''
    expect(text).toContain('Câble 2,5 mm²')
    expect(text).toContain('12,5 m × 400 FCFA')
    expect(text).toContain('Remise : −100 FCFA')
    expect(text).toContain('Espèces12 345 FCFA')
    expect(text).toContain('Espèces remises20 000 FCFA')
    expect(text).toContain('Route de Rufisque, Pikine')
    expect(text).not.toMatch(/TVA|conforme|fiscal/i)
  })
})

const installed: FakeResult = { data: null, count: 0 }
const openSession: FakeResult = { data: { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 10000, opened_at: '2026-10-16T08:00:00Z', opened_by: 'u-1' } }
const units: FakeResult = { data: [{ id: 'unit-u', code: 'u', label: 'Pièce', dimension: 'count', decimal_places: 0 }] }
const settings: FakeResult = { data: { settings: {} } }
const noSales: FakeResult = { data: [] }
const issuedSale: FakeResult = {
  data: [{ id: 'doc-1', order_id: 'order-1', document_number: 'TICKET-2026-000042', status: 'issued', total_amount: 12345, issued_at: '2026-10-16T09:30:00Z', void_reason: null, content_snapshot: frozen }],
}

describe('écran Ventes et caisse', () => {
  it('reste désactivé avec un message clair si la migration n’est pas appliquée', async () => {
    setup('owner', [{ error: { code: 'PGRST205', message: 'Could not find the table public.document_counters' } }])
    expect(await screen.findByText(/la migration/)).toBeTruthy()
    expect(screen.getByText(MANUAL_PAYMENT_NOTICE)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ouvrir la caisse' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull()
  })

  it('ouvre la caisse par open_cash_session quand la fonction existe', async () => {
    const fake = setup('editor', [installed, { data: null }, units, settings, noSales, { data: 'sess-9' }, installed, { data: null }, units, settings, noSales])
    fireEvent.change(await screen.findByLabelText('Fond de caisse (FCFA)'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la caisse' }))
    await screen.findByText('Aucune vente sur cette période.')
    const call = fake.queries.find((q) => q.table === 'rpc:open_cash_session')
    expect(fake.op(call!, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_opening_cash: 5000, p_note: null })
    expect(fake.queries.some((q) => q.table === 'cash_register_sessions' && q.ops.some(([n]) => n === 'insert'))).toBe(false)
  })

  it('ouvre la caisse par insertion directe tant que la fonction n’existe pas', async () => {
    const fake = setup('editor', [installed, { data: null }, units, settings, noSales, { error: { code: 'PGRST202', message: 'not found' } }, {}, installed, { data: null }, units, settings, noSales])
    fireEvent.change(await screen.findByLabelText('Fond de caisse (FCFA)'), { target: { value: '15 000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la caisse' }))
    expect(await screen.findByText('Aucune vente sur cette période.')).toBeTruthy()
    const insert = fake.queries.find((q) => q.table === 'cash_register_sessions' && q.ops.some(([n]) => n === 'insert'))
    expect(fake.op(insert!, 'insert')?.[0]).toMatchObject({ site_id: SITE, opened_by: 'u-1', opening_cash: 15000 })
  })

  it('encaisse sans jamais envoyer de prix et affiche le numéro du reçu', async () => {
    const product = { id: 'p-1', name: 'Marteau', sku: 'MAR-1', barcode: '6001', price: 5000, currency_code: 'XOF', track_inventory: true }
    const fake = setup('editor', [
      installed, openSession, units, settings, noSales,
      { data: [product] },
      { data: [{ id: 'su-1', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] },
      { data: [] },
      { data: { order_id: 'order-1', document_id: 'doc-1', document_number: 'TICKET-2026-000001', grand_total: 10000, change_given: 5000, snapshot: frozen } },
      noSales,
    ])
    fireEvent.change(await screen.findByLabelText('Rechercher un produit ou scanner un code-barres'), { target: { value: 'Mart' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter$/ }))
    fireEvent.change(screen.getByLabelText('Quantité de Marteau'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '15000' } })
    expect(within(screen.getByRole('table', { name: 'Panier' })).getByText('10 000 FCFA')).toBeTruthy()
    expect(screen.getByText('5 000 FCFA', { selector: 'dd' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))
    expect(await screen.findByText('TICKET-2026-000001')).toBeTruthy()

    const call = fake.queries.find((q) => q.table === 'rpc:record_sale')
    const args = fake.op(call!, 'rpc')?.[0] as Record<string, unknown>
    expect(args).toMatchObject({ p_site_id: SITE, p_cash_session_id: 'sess-1', p_payments: [{ method: 'cash', amount: 15000 }], p_discount: {} })
    expect(args.p_lines).toEqual([{ product_id: 'p-1', unit_id: 'unit-u', quantity: 2 }])
    expect(JSON.stringify(args)).not.toMatch(/price|total/)
  })

  it('transmet le motif quand seule une remise de ligne est appliquée', async () => {
    const product = { id: 'p-1', name: 'Marteau', sku: null, barcode: null, price: 5000, currency_code: 'XOF', track_inventory: true }
    const fake = setup('owner', [
      installed, openSession, units, settings, noSales,
      { data: [product] },
      { data: [{ id: 'su-1', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] },
      { data: [] },
      { data: { order_id: 'order-2', document_id: 'doc-2', document_number: 'TICKET-2026-000002', grand_total: 4500, change_given: 0, snapshot: frozen } },
      noSales,
    ])
    fireEvent.change(await screen.findByLabelText('Rechercher un produit ou scanner un code-barres'), { target: { value: 'Mart' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter$/ }))
    fireEvent.change(screen.getByLabelText('Remise sur Marteau'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '4500' } })
    expect(screen.getByText('Le motif de la remise est obligatoire.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Motif de la remise'), { target: { value: 'Client fidèle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))
    await screen.findByText('TICKET-2026-000002')
    const args = fake.op(fake.queries.find((q) => q.table === 'rpc:record_sale')!, 'rpc')?.[0] as Record<string, unknown>
    expect(args.p_lines).toEqual([{ product_id: 'p-1', unit_id: 'unit-u', quantity: 1, discount: 500 }])
    expect(args.p_discount).toEqual({ reason: 'Client fidèle' })
  })

  it('bloque l’encaissement si le paiement est insuffisant', async () => {
    const product = { id: 'p-1', name: 'Marteau', sku: null, barcode: null, price: 5000, currency_code: 'XOF', track_inventory: true }
    setup('owner', [
      installed, openSession, units, settings, noSales,
      { data: [product] },
      { data: [{ id: 'su-1', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] },
      { data: [] },
    ])
    fireEvent.change(await screen.findByLabelText('Rechercher un produit ou scanner un code-barres'), { target: { value: 'Mart' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter$/ }))
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '4000' } })
    expect(screen.getByText('Paiement insuffisant : il manque 1 000 FCFA.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Encaisser' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('consultation seule pour un viewer : ni encaissement ni annulation', async () => {
    setup('viewer', [installed, openSession, units, settings, issuedSale], 'u-2')
    expect(await screen.findByText(/Consultation seule/)).toBeTruthy()
    expect(screen.getByText('TICKET-2026-000042')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clôturer (Z)' })).toBeNull()
  })

  it('annulation par un admin : motif obligatoire, appel de void_sale', async () => {
    const fake = setup('admin', [
      installed, openSession, units, settings, issuedSale,
      { data: { order_id: 'order-1', stock_movements_reversed: 1, documents_voided: 1, cash_refund: 12345, cash_refund_recorded: true, cash_session_closed: false } },
      noSales,
    ], 'u-3')
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    const confirm = screen.getByRole('button', { name: 'Confirmer l’annulation' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motif d’annulation de TICKET-2026-000042'), { target: { value: 'Erreur de saisie' } })
    fireEvent.click(confirm)
    expect(await screen.findByText(/annulée, stock rétabli/)).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:void_sale')
    expect(fake.op(call!, 'rpc')?.[0]).toEqual({ p_order_id: 'order-1', p_reason: 'Erreur de saisie' })
  })
})

describe('confirmation et historique des ventes', () => {
  const product = { id: 'p-1', name: 'Marteau', sku: 'MAR-1', barcode: null, price: 5000, currency_code: 'XOF', track_inventory: true }
  const sellUnit = { data: [{ id: 'su-1', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] }
  const sold = { data: { order_id: 'order-9', document_id: 'doc-9', document_number: 'TICKET-2026-000009', grand_total: 12345, change_given: 7655, snapshot: frozen } }

  it('affiche l’écran de confirmation, imprime depuis l’instantané et repart sur une nouvelle vente', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    setup('editor', [installed, openSession, units, settings, noSales, { data: [product] }, sellUnit, { data: [] }, sold, noSales])
    fireEvent.change(await screen.findByLabelText('Rechercher un produit ou scanner un code-barres'), { target: { value: 'Mart' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter$/ }))
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))

    const confirmation = await screen.findByRole('region', { name: 'Vente enregistrée' })
    expect(within(confirmation).getByText('TICKET-2026-000009')).toBeTruthy()
    expect(within(confirmation).getByText('7 655 FCFA')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull()

    fireEvent.click(within(confirmation).getByRole('button', { name: /Imprimer le ticket \(80 mm\)/ }))
    const ticket = await screen.findByRole('article', { name: 'Ticket de caisse TICKET-2026-000042', hidden: true })
    expect(ticket.textContent).toContain('12 345 FCFA')
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1))

    fireEvent.click(within(confirmation).getByRole('button', { name: /Imprimer le reçu \(A4\)/ }))
    expect(await screen.findByRole('article', { name: 'Reçu de vente TICKET-2026-000042', hidden: true })).toBeTruthy()

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Nouvelle vente' }))
    expect(screen.queryByRole('region', { name: 'Vente enregistrée' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeTruthy()
    expect(screen.getByText('Panier vide')).toBeTruthy()
    print.mockRestore()
  })

  it('liste date, numéro, total, paiement, vendeur et statut ; un ticket annulé se réimprime avec ANNULÉ', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const voided: FakeResult = { data: [{ id: 'doc-2', order_id: 'order-2', document_number: 'TICKET-2026-000043', status: 'void', total_amount: 12345, issued_at: '2026-10-16T10:00:00Z', void_reason: 'Erreur', content_snapshot: frozen }] }
    setup('editor', [installed, openSession, units, settings, voided])
    const table = await screen.findByRole('table', { name: 'Ventes' })
    const row = within(table).getByText('TICKET-2026-000043').closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(0, 6)).toEqual(['16/10/2026 10:00', 'TICKET-2026-000043', '12 345 FCFA', 'Espèces', 'Awa', 'ANNULÉ'])
    expect(within(row).queryByRole('button', { name: 'Annuler' })).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: 'Réimprimer le ticket TICKET-2026-000043' }))
    const ticket = await screen.findByRole('article', { name: 'Ticket de caisse TICKET-2026-000042', hidden: true })
    expect(ticket.textContent).toContain('ANNULÉ')
    expect(ticket.textContent).toContain('999 FCFA')
    print.mockRestore()
  })

  it('filtre par période (jours à Dakar) et recherche par numéro', async () => {
    const fake = setup('viewer', [installed, openSession, units, settings, noSales, noSales, noSales])
    await screen.findByText('Aucune vente sur cette période.')
    const first = fake.queries.filter((q) => q.table === 'store_documents')[0]
    expect(fake.op(first, 'eq')).toEqual(['site_id', SITE])
    expect(fake.op(first, 'ilike')).toBeUndefined()

    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-10-02' } })
    await vi.waitFor(() => {
      const last = fake.queries.filter((q) => q.table === 'store_documents').slice(-1)[0]
      expect(fake.op(last, 'gte')).toEqual(['issued_at', '2026-10-01T00:00:00.000Z'])
      expect(fake.op(last, 'lt')).toEqual(['issued_at', '2026-10-03T00:00:00.000Z'])
    })

    fireEvent.change(screen.getByLabelText('Rechercher un numéro de ticket'), { target: { value: 'ticket-2026-42%' } })
    await vi.waitFor(() => {
      const last = fake.queries.filter((q) => q.table === 'store_documents').slice(-1)[0]
      expect(fake.op(last, 'ilike')).toEqual(['document_number', '%TICKET-2026-42%'])
    })
  })

  it('signale un intervalle de dates inversé sans interroger la base', async () => {
    const fake = setup('viewer', [installed, openSession, units, settings, noSales])
    await screen.findByText('Aucune vente sur cette période.')
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-10-01' } })
    expect(await screen.findByText('La date de fin précède la date de début.')).toBeTruthy()
    expect(fake.queries.filter((q) => q.table === 'store_documents')).toHaveLength(1)
  })
})

