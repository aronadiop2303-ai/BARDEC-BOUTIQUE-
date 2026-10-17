// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import CashMovementsPanel from './CashMovementsPanel'
import PosPage from './PosPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'
const session = { id: 'sess-1', register_name: 'Caisse principale', status: 'open', opening_cash: 10000, opened_at: '2026-10-17T08:00:00Z', opened_by: 'u-1' }

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

const summary = (expected: number): FakeResult => ({
  data: { session_id: 'sess-1', register_name: 'Caisse principale', status: 'open', opened_at: '', closed_at: null, currency: 'XOF', opening_cash: 10000, cash_in: 0, cash_out: 0, corrections_excluded: 0, expected_cash: expected, counted_cash: null, discrepancy: null, by_method: {}, sales_count: 0, voided_count: 0 },
})
const movements: FakeResult = { data: [{ id: 'm1', movement_type: 'expense', amount: 1500, reason: 'Sachets', created_at: '2026-10-17T09:00:00Z', actor_user_id: 'u-1', cash_movement_details: { receipt_ref: 'REC-12' } }] }

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: /Dépense, apport, retrait, dépôt/ }))
  return screen.findByText(/Espèces attendues \(rapport X/)
}

describe('mouvements de caisse', () => {
  it('replié par défaut : aucune requête tant qu’il n’est pas ouvert', () => {
    const { fake, ctx } = context('owner', [])
    render(<CashMovementsPanel ctx={ctx} session={session} cashierCap={0} />)
    expect(fake.queries).toHaveLength(0)
  })

  it('propriétaire : 4 types, dépôt en banque enregistré par record_cash_movement', async () => {
    const { fake, ctx } = context('owner', [movements, summary(48500), { data: { movement_id: 'm2', expected_cash: 28500 } }, movements, summary(28500)])
    render(<CashMovementsPanel ctx={ctx} session={session} cashierCap={0} />)
    await openPanel()
    expect(screen.getByText('48 500 FCFA')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Mouvements de la session' })
    expect(within(table).getByText('REC-12')).toBeTruthy()
    expect(within(table).getByText('−1 500 FCFA')).toBeTruthy()

    const select = screen.getByLabelText('Type') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['expense', 'cash_in', 'cash_out', 'deposit'])
    fireEvent.change(select, { target: { value: 'deposit' } })
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '20 000' } })
    const save = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motif (obligatoire)'), { target: { value: 'Versement CBAO' } })
    fireEvent.change(screen.getByLabelText(/Justificatif/), { target: { value: 'BORD-77' } })
    fireEvent.click(save)
    expect(await screen.findByText(/Dépôt en banque de 20 000 FCFA enregistré\(e\)\. Espèces attendues : 28 500 FCFA/)).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:record_cash_movement')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_session_id: 'sess-1', p_movement_type: 'deposit', p_amount: 20000, p_reason: 'Versement CBAO', p_receipt_ref: 'BORD-77' })
  })

  it('sortie supérieure aux espèces attendues : bloquée avant envoi', async () => {
    const { fake, ctx } = context('manager', [{ data: [] }, summary(1000)])
    render(<CashMovementsPanel ctx={ctx} session={session} cashierCap={0} />)
    await openPanel()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'cash_out' } })
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Motif (obligatoire)'), { target: { value: 'Retrait gérant' } })
    expect(screen.getByText('Espèces insuffisantes en caisse pour cette sortie.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fake.queries.some((q) => q.table === 'rpc:record_cash_movement')).toBe(false)
  })

  it('vendeur : dépense seulement, sous le plafond ; refus de la base affiché', async () => {
    const { ctx } = context('cashier', [{ data: [] }, summary(50000), { error: { code: '42501', message: 'Dépense supérieure au plafond autorisé pour un vendeur (3000 XOF).' } }])
    render(<CashMovementsPanel ctx={ctx} session={session} cashierCap={3000} />)
    await openPanel()
    expect([...(screen.getByLabelText('Type') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['expense'])
    expect(screen.getByText(/petites dépenses seulement, 3 000 FCFA au plus/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '4000' } })
    fireEvent.change(screen.getByLabelText('Motif (obligatoire)'), { target: { value: 'Carburant' } })
    expect(screen.getByText('Dépense supérieure au plafond autorisé pour un vendeur (3000).')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText(/plafond autorisé pour un vendeur \(3000 XOF\)/)).toBeTruthy()
  })
})

describe('rapport X', () => {
  it('ventile les mouvements par type, montants renvoyés par la base', async () => {
    const { ctx } = context('viewer', [
      { data: null, count: 0 }, { data: session }, { data: [] }, { data: { settings: {} } }, { data: [] },
      summary(40500),
      { data: { sale_cash: { count: 3, amount: 35000 }, expense: { count: 1, amount: 1500 }, deposit: { count: 1, amount: 3000 } } },
    ])
    render(<PosPage ctx={ctx} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rapport X' }))
    const report = await screen.findByLabelText('Rapport X')
    expect(report.textContent).toContain('— Ventes en espèces (3)+35 000 FCFA')
    expect(report.textContent).toContain('— Dépenses (1)−1 500 FCFA')
    expect(report.textContent).toContain('— Dépôts en banque (1)−3 000 FCFA')
    expect(report.textContent).toContain('40 500 FCFA')
    expect(screen.queryByRole('region', { name: 'Mouvements de caisse' })).toBeNull()
  })
})
