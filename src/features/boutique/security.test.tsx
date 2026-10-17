// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import DataSecurityPage from './DataSecurityPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: EffectiveRole, responses: FakeResult[], signOut?: (options: unknown) => Promise<{ error: null }>) {
  const fake = fakeSupabase(responses)
  if (signOut) (fake.client as unknown as { auth: unknown }).auth = { signOut }
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role: 'viewer', isHardware: true },
    can: permissionsFor(role),
    staffRole: role,
  }
  render(<DataSecurityPage ctx={ctx} />)
  return fake
}

const exportPayload: FakeResult = {
  data: {
    format: 'bardec-boutique-export', version: 1, site_id: SITE, exported_at: '2026-10-17T10:00:00Z', row_limit_per_table: 20000,
    truncated_tables: [], tables: { products: [{ id: 'p1', name: 'Marteau' }], store_customers: [] },
  },
}

describe('données et sécurité', () => {
  it('propriétaire : export préparé par la base, JSON et CSV par table', async () => {
    const fake = setup('owner', [exportPayload])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Export des données', 'Journal d’audit', 'Mes sessions'])
    fireEvent.click(screen.getByRole('button', { name: 'Préparer l’export' }))
    const table = await screen.findByRole('table', { name: 'Tables exportées' })
    expect(within(table).getByText('products')).toBeTruthy()
    expect((within(table).getByRole('button', { name: 'Télécharger store_customers en CSV' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Tout télécharger \(JSON\)/ })).toBeTruthy()
    expect(fake.op(fake.queries[0], 'rpc')?.[0]).toEqual({ p_site_id: SITE })
  })

  it('gérant : pas d’export, journal d’audit sans données personnelles', async () => {
    setup('manager', [{ data: [
      { occurred_at: '2026-10-17T09:00:00Z', actor_name: 'Awa', category: 'Ventes', action: 'void_sale', reference: 'TICKET-2026-000004', amount: 12000 },
      { occurred_at: '2026-10-17T08:00:00Z', actor_name: 'Moussa', category: 'Crédit', action: 'credit_limit_override', reference: 'TICKET-2026-000003', amount: 5000 },
    ] }])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Journal d’audit', 'Mes sessions'])
    const table = await screen.findByRole('table', { name: 'Actions' })
    expect(within(table).getByText('Annulation de vente')).toBeTruthy()
    expect(within(table).getByText('Dépassement de plafond autorisé')).toBeTruthy()
    expect(table.textContent).not.toMatch(/@|77\d{7}/)
  })

  it('vendeur : uniquement ses sessions ; déconnexion des autres sessions', async () => {
    let scope: unknown = null
    setup('cashier', [
      { data: [{ session_id: 's1', created_at: '2026-10-17T08:00:00Z', last_activity_at: '2026-10-17T09:30:00Z', user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36', ip: '41.82.0.1' }] },
      { data: [] },
    ], async (options) => { scope = options; return { error: null } })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mes sessions'])
    expect(await screen.findByText('Chrome sur Android')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Déconnecter mes autres sessions/ }))
    expect(await screen.findByText(/Vos autres sessions sont déconnectées/)).toBeTruthy()
    expect(scope).toEqual({ scope: 'others' })
  })
})
