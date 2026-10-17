// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import BoutiqueLayout from './BoutiqueLayout'
import TeamPage, { NO_SMTP_NOTICE } from './TeamPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function context(staffRole: EffectiveRole, responses: FakeResult[], userId = 'owner-1') {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId, siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner-1' }, role: staffRole === 'owner' ? 'owner' : 'viewer', isHardware: true },
    can: permissionsFor(staffRole),
    staffRole,
  }
  return { fake, ctx }
}

const members: FakeResult = {
  data: [
    { user_id: 'owner-1', email: 'moussa@example.sn', display_name: 'Moussa', staff_role: 'owner', is_active: true, invited_by_name: null, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-10-17T08:00:00Z' },
    { user_id: 'mgr-1', email: 'fatou@example.sn', display_name: 'Fatou', staff_role: 'manager', is_active: true, invited_by_name: 'Moussa', created_at: '2026-10-02T00:00:00Z', last_sign_in_at: null },
    { user_id: 'cash-1', email: 'awa@example.sn', display_name: 'Awa', staff_role: 'cashier', is_active: true, invited_by_name: 'Moussa', created_at: '2026-10-03T00:00:00Z', last_sign_in_at: null },
  ],
}

describe('écran Équipe', () => {
  it('migration absente : message clair, aucune action', async () => {
    const { ctx } = context('owner', [{ error: { code: 'PGRST202', message: 'Could not find the function public.list_site_staff' } }])
    render(<TeamPage ctx={ctx} />)
    expect(await screen.findByText(/la migration/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Inviter' })).toBeNull()
  })

  it('propriétaire : liste, rôle, statut ; ne peut ni se modifier ni se désactiver', async () => {
    const { ctx } = context('owner', [members])
    render(<TeamPage ctx={ctx} />)
    const table = await screen.findByRole('table', { name: 'Équipe' })
    const ownerRow = within(table).getByText('Moussa').closest('tr') as HTMLElement
    expect(within(ownerRow).queryByRole('button')).toBeNull()
    expect(within(ownerRow).queryByRole('combobox')).toBeNull()
    expect(within(table).getByLabelText('Rôle de Fatou')).toBeTruthy()
    expect(within(table).getAllByText('Jamais connecté')).toHaveLength(2)
    expect(screen.getByText(NO_SMTP_NOTICE)).toBeTruthy()
  })

  it('gérant : ne peut pas nommer de gérant ni modifier un autre gérant', async () => {
    const { ctx } = context('manager', [members], 'mgr-2')
    render(<TeamPage ctx={ctx} />)
    const table = await screen.findByRole('table', { name: 'Équipe' })
    const fatou = within(table).getByText('Fatou').closest('tr') as HTMLElement
    expect(within(fatou).queryByRole('button', { name: 'Désactiver' })).toBeNull()
    const roles = within(screen.getByRole('region', { name: 'Inviter un membre' })).getByLabelText('Rôle') as HTMLSelectElement
    expect([...roles.options].map((o) => o.value)).toEqual(['cashier', 'stock_keeper', 'driver'])
    const awaRole = within(table).getByLabelText('Rôle de Awa') as HTMLSelectElement
    expect([...awaRole.options].map((o) => o.value)).not.toContain('manager')
  })

  it('invitation : appelle invite-staff, affiche le lien à transmettre et le bouton WhatsApp', async () => {
    const { fake, ctx } = context('owner', [
      members,
      { data: { user_id: 'new-user', existing_account: false, email_sent: false, action_link: 'https://projet.supabase.co/auth/v1/verify?token=abc' } },
      members,
    ])
    render(<TeamPage ctx={ctx} />)
    const form = await screen.findByRole('region', { name: 'Inviter un membre' })
    fireEvent.change(within(form).getByLabelText('Adresse e-mail'), { target: { value: ' Ndeye@Example.SN ' } })
    fireEvent.change(within(form).getByLabelText('Rôle'), { target: { value: 'stock_keeper' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Inviter' }))
    expect((await screen.findByLabelText('Lien d’invitation') as HTMLInputElement).value).toContain('token=abc')
    const call = fake.queries.find((q) => q.table === 'fn:invite-staff')!
    expect(fake.op(call, 'invoke')?.[0]).toEqual({ body: { site_id: SITE, email: 'ndeye@example.sn', staff_role: 'stock_keeper' } })
    expect((screen.getByRole('link', { name: /Envoyer par WhatsApp/ }) as HTMLAnchorElement).href).toMatch(/^https:\/\/wa\.me\/\?text=/)
  })

  it('compte existant : aucun lien affiché', async () => {
    const { ctx } = context('owner', [members, { data: { user_id: 'x', existing_account: true, email_sent: false, action_link: null } }, members])
    render(<TeamPage ctx={ctx} />)
    const form = await screen.findByRole('region', { name: 'Inviter un membre' })
    fireEvent.change(within(form).getByLabelText('Adresse e-mail'), { target: { value: 'awa2@example.sn' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Inviter' }))
    expect(await screen.findByText(/a déjà un compte/)).toBeTruthy()
    expect(screen.queryByLabelText('Lien d’invitation')).toBeNull()
  })

  it('désactivation : appelle set_staff_active', async () => {
    const { fake, ctx } = context('owner', [members, {}, members])
    render(<TeamPage ctx={ctx} />)
    const table = await screen.findByRole('table', { name: 'Équipe' })
    fireEvent.click(within(within(table).getByText('Awa').closest('tr') as HTMLElement).getByRole('button', { name: 'Désactiver' }))
    expect(await screen.findByText('Awa est désactivé(e).')).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:set_staff_active')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_user_id: 'cash-1', p_active: false, p_reason: null })
  })
})

describe('navigation selon le rôle', () => {
  const nav = () => within(screen.getByRole('navigation', { name: 'Espace de gestion' })).getAllByRole('link').map((a) => a.textContent)

  it('livreur : tableau de bord et « Mes livraisons » vide et honnête', () => {
    const { ctx } = context('driver', [])
    render(<BoutiqueLayout ctx={ctx} section="livraisons" itemId={null} />)
    expect(nav()).toEqual(['Tableau de bord', 'Mes livraisons'])
    expect(screen.getByText('Aucune livraison ne vous est assignée.')).toBeTruthy()
  })

  it('magasinier : pas de caisse ; accès direct à la caisse refusé', () => {
    const { ctx } = context('stock_keeper', [])
    render(<BoutiqueLayout ctx={ctx} section="ventes" itemId={null} />)
    expect(nav()).not.toContain('Ventes et caisse')
    expect(nav()).toContain('Stock')
    expect(screen.getByText(/n’est pas accessible avec votre rôle \(Magasinier\)/)).toBeTruthy()
  })

  it('vendeur : caisse, pas d’équipe ni de paramètres', () => {
    const { ctx } = context('cashier', [])
    render(<BoutiqueLayout ctx={ctx} section="equipe" itemId={null} />)
    expect(nav()).toContain('Ventes et caisse')
    expect(nav()).not.toContain('Équipe')
    expect(nav()).not.toContain('Paramètres boutique')
    expect(screen.getByText(/n’est pas accessible avec votre rôle/)).toBeTruthy()
  })
})
