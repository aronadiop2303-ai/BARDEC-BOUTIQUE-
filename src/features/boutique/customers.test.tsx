// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import CustomersPage, { NO_REMINDER_NOTICE } from './CustomersPage'
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

const moussa = { id: 'c-1', name: 'Moussa Ndiaye', phone: '771234567', address: 'Pikine', credit_limit: 50000, is_active: true }
const customers: FakeResult = { data: [moussa, { id: 'c-2', name: 'Awa Diallo', phone: null, address: null, credit_limit: 0, is_active: true }] }
const receivables: FakeResult = { data: [{ customer_id: 'c-1', name: 'Moussa Ndiaye', phone: '771234567', credit_limit: 50000, balance: 42000, oldest_unpaid_at: '2026-08-01T10:00:00Z', days_outstanding: 77 }] }
const statement: FakeResult = {
  data: {
    customer: { ...moussa },
    entries: [
      { date: '2026-08-01T10:00:00Z', type: 'credit_sale', document_number: 'TICKET-2026-000010', method: null, reference: null, note: null, override_reason: null, debit: 50000, credit: 0, balance: 50000 },
      { date: '2026-09-01T10:00:00Z', type: 'payment', document_number: null, method: 'wave', reference: 'W-1', note: null, override_reason: null, debit: 0, credit: 8000, balance: 42000 },
    ],
    balance: 42000,
    generated_at: '2026-10-17T10:00:00Z',
  },
}

describe('clients et crédit', () => {
  it('migration absente : message clair', async () => {
    const { ctx } = context('owner', [{ error: { code: 'PGRST205', message: 'store_customers' } }, { data: [] }])
    render(<CustomersPage ctx={ctx} />)
    expect(await screen.findByText(/la migration customers_credit/)).toBeTruthy()
  })

  it('liste avec soldes de la base ; impayés par ancienneté ; pas de relance automatique', async () => {
    const { ctx } = context('owner', [customers, receivables])
    render(<CustomersPage ctx={ctx} />)
    const list = await screen.findByRole('table', { name: 'Liste des clients' })
    const row = within(list).getByText('Moussa Ndiaye').closest('tr') as HTMLElement
    expect(row.textContent).toContain('42 000 FCFA')
    expect(screen.getByText(NO_REMINDER_NOTICE)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Impayés (1)' }))
    const unpaid = screen.getByRole('table', { name: 'Liste des impayés' })
    expect(within(unpaid).getByText('77')).toBeTruthy()
    expect(screen.getByText('61 à 90 jours (1)')).toBeTruthy()
  })

  it('relevé avec solde progressif et versement en espèces dans la caisse ouverte', async () => {
    const { fake, ctx } = context('cashier', [
      customers, receivables, statement,
      { data: { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 0, opened_at: '', opened_by: 'u-1' } },
      { data: { entry_id: 'e-3', customer_id: 'c-1', amount: 12000, balance: 30000 } },
      statement, customers, receivables,
    ])
    render(<CustomersPage ctx={ctx} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Moussa Ndiaye' }))
    const ops = await screen.findByRole('table', { name: 'Opérations' })
    expect(within(ops).getByText('TICKET-2026-000010')).toBeTruthy()
    expect(within(ops).getAllByText('42 000 FCFA').length).toBeGreaterThan(0)
    expect((screen.getByLabelText('Plafond de crédit (FCFA)') as HTMLInputElement).disabled).toBe(true)

    const form = screen.getByRole('region', { name: 'Versement' })
    fireEvent.change(within(form).getByLabelText('Montant (FCFA)'), { target: { value: '50000' } })
    expect(within(form).getByText('Versement supérieur au solde dû.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Montant (FCFA)'), { target: { value: '12000' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le versement' }))
    expect(await screen.findByText(/Nouveau solde : 30 000 FCFA/)).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:record_customer_payment')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_customer_id: 'c-1', p_amount: 12000, p_method: 'cash', p_cash_session_id: 'sess-1', p_reference: null, p_note: null })
  })
})

describe('vente à crédit à la caisse', () => {
  const installed: FakeResult = { data: null, count: 0 }
  const session: FakeResult = { data: { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 0, opened_at: '2026-10-17T08:00:00Z', opened_by: 'u-1' } }
  const units: FakeResult = { data: [{ id: 'unit-u', code: 'u', label: 'Pièce', dimension: 'count', decimal_places: 0 }] }
  const product = { id: 'p-1', name: 'Ciment 50 kg', sku: null, barcode: null, price: 5000, currency_code: 'XOF', track_inventory: true }
  const sellUnit: FakeResult = { data: [{ id: 'su', product_id: 'p-1', unit_id: 'unit-u', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 1 }] }

  async function fillCart(qty: string) {
    fireEvent.change(await screen.findByLabelText('Rechercher un produit ou scanner un code-barres'), { target: { value: 'Cim' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter$/ }))
    fireEvent.change(screen.getByLabelText('Quantité de Ciment 50 kg'), { target: { value: qty } })
    fireEvent.change(screen.getByLabelText('Moyen de paiement 1'), { target: { value: 'credit' } })
  }

  it('vendeur : fiche client obligatoire, plafond dépassé bloqué', async () => {
    const { fake } = (() => {
      const r = context('cashier', [installed, session, units, { data: { settings: {} } }, { data: [] }, { data: [product] }, sellUnit, { data: [] }, { data: [moussa] }, receivables])
      render(<PosPage ctx={r.ctx} />)
      return r
    })()
    await fillCart('2')
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '10000' } })
    expect((screen.getByRole('button', { name: 'Encaisser' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Client (facultatif)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Rechercher la fiche client'), { target: { value: 'Mou' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }))
    expect(await screen.findByText('Plafond de crédit dépassé : autorisation du gérant nécessaire.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Encaisser' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fake.queries.some((q) => q.table === 'rpc:record_credit_sale')).toBe(false)
  })

  it('gérant : dépassement autorisé avec motif, vente par record_credit_sale', async () => {
    const r = context('manager', [
      installed, session, units, { data: { settings: {} } }, { data: [] }, { data: [product] }, sellUnit, { data: [] }, { data: [moussa] }, receivables,
      { data: { order_id: 'o-1', document_id: 'd-1', document_number: 'TICKET-2026-000020', grand_total: 10000, change_given: 0, snapshot: null, customer_id: 'c-1', credit_amount: 10000, customer_balance: 52000, credit_limit: 50000, limit_overridden: true } },
      { data: [] },
    ])
    render(<PosPage ctx={r.ctx} />)
    await fillCart('2')
    fireEvent.change(screen.getByLabelText('Montant du paiement 1'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Rechercher la fiche client'), { target: { value: 'Mou' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }))
    expect(await screen.findByText(/Plafond dépassé de 2 000 FCFA/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Motif d’autorisation'), { target: { value: 'Chantier en cours, paiement fin de mois' } })
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }))
    expect(await screen.findByText('TICKET-2026-000020')).toBeTruthy()
    const call = r.fake.queries.find((q) => q.table === 'rpc:record_credit_sale')!
    expect(r.fake.op(call, 'rpc')?.[0]).toMatchObject({
      p_site_id: SITE, p_cash_session_id: 'sess-1', p_customer_id: 'c-1',
      p_payments: [{ method: 'credit', amount: 10000 }], p_override_reason: 'Chantier en cours, paiement fin de mois',
    })
    expect(r.fake.queries.some((q) => q.table === 'rpc:record_sale')).toBe(false)
  })
})
