import { describe, expect, it, vi } from 'vitest'
import { createInviteHandler, type AdminClient, type InviteDeps, type UserClient } from '../../../supabase/functions/invite-staff/handler'

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(options: { callerId?: string | null; callerRole?: string | null; existingId?: string | null; registerError?: { code: string; message: string }; sendEmail?: boolean } = {}) {
  const calls: string[] = []
  const userClient = vi.fn((): UserClient => ({
    auth: { getUser: async () => ({ data: { user: options.callerId === null ? null : { id: options.callerId ?? 'owner-1' } }, error: null }) },
    rpc: async () => ({ data: options.callerRole === undefined ? 'owner' : options.callerRole, error: null }),
  }))
  const generateLink = vi.fn(async () => ({ data: { user: { id: 'new-user' }, properties: { action_link: 'https://x/verify?token=secret' } }, error: null }))
  const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: 'mailed-user' } }, error: null }))
  const register = vi.fn(async (_fn: string, _args: unknown) => ({ data: options.registerError ? null : { ok: true }, error: options.registerError ?? null }))
  const admin = {
    rpc: async (fn: string, args: unknown) => {
      calls.push(fn)
      if (fn === 'staff_lookup_user_id') return { data: options.existingId ?? null, error: null }
      return register(fn, args)
    },
    auth: { admin: { generateLink, inviteUserByEmail } },
  } as unknown as AdminClient
  const deps: InviteDeps = { userClient, adminClient: () => admin, sendEmail: options.sendEmail ?? false, allowedOrigin: 'https://app.test', redirectTo: 'https://app.test' }
  return { handle: createInviteHandler(deps), generateLink, inviteUserByEmail, register, calls, userClient }
}

const post = (body: unknown, auth = 'Bearer jeton') =>
  new Request('https://fn.test/invite-staff', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })

const valid = { site_id: SITE, email: 'awa@example.sn', staff_role: 'cashier' }

describe('Edge Function invite-staff', () => {
  it('répond au pré-vol CORS et refuse les autres méthodes', async () => {
    const { handle } = setup()
    expect((await handle(new Request('https://fn.test', { method: 'OPTIONS' }))).status).toBe(204)
    expect((await handle(new Request('https://fn.test', { method: 'GET' }))).status).toBe(405)
  })

  it('exige un jeton et une session valide', async () => {
    expect((await setup().handle(post(valid, ''))).status).toBe(401)
    expect((await setup({ callerId: null }).handle(post(valid))).status).toBe(401)
  })

  it('refuse un vendeur, et un gérant qui nomme un gérant', async () => {
    const cashier = setup({ callerRole: 'cashier' })
    expect((await cashier.handle(post(valid))).status).toBe(403)
    expect(cashier.generateLink).not.toHaveBeenCalled()
    const manager = setup({ callerRole: 'manager' })
    expect((await manager.handle(post({ ...valid, staff_role: 'manager' }))).status).toBe(403)
  })

  it('nouveau compte sans SMTP : lien d’invitation créé et renvoyé, inscription par la base avec l’appelant vérifié', async () => {
    const { handle, generateLink, register } = setup()
    const response = await handle(post(valid))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user_id: 'new-user', existing_account: false, email_sent: false, action_link: 'https://x/verify?token=secret' })
    expect(generateLink).toHaveBeenCalledWith({ type: 'invite', email: 'awa@example.sn', options: { redirectTo: 'https://app.test' } })
    expect(register).toHaveBeenCalledWith('staff_register_invitation', { p_site_id: SITE, p_user_id: 'new-user', p_staff_role: 'cashier', p_invited_by: 'owner-1' })
  })

  it('compte existant : AUCUN lien n’est créé ni renvoyé', async () => {
    const { handle, generateLink, inviteUserByEmail } = setup({ existingId: 'existing-user' })
    const body = await (await handle(post(valid))).json()
    expect(body).toEqual({ user_id: 'existing-user', existing_account: true, email_sent: false, action_link: null })
    expect(generateLink).not.toHaveBeenCalled()
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('refuse de s’inviter soi-même', async () => {
    const { handle, register } = setup({ existingId: 'owner-1' })
    expect((await handle(post(valid))).status).toBe(400)
    expect(register).not.toHaveBeenCalled()
  })

  it('avec SMTP : e-mail envoyé, pas de lien renvoyé', async () => {
    const { handle, generateLink } = setup({ sendEmail: true })
    expect(await (await handle(post(valid))).json()).toEqual({ user_id: 'mailed-user', existing_account: false, email_sent: true, action_link: null })
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('transmet le refus de la base (rôle recontrôlé côté SQL)', async () => {
    const response = await setup({ registerError: { code: '42501', message: 'Invitation refusée.' } }).handle(post(valid))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Invitation refusée.' })
    const duplicate = await setup({ registerError: { code: '23505', message: 'Déjà dans l’équipe.' } }).handle(post(valid))
    expect(duplicate.status).toBe(409)
  })

  it('aucune clé ni jeton dans la réponse d’erreur', async () => {
    const text = await (await setup({ callerRole: 'driver' }).handle(post(valid))).text()
    expect(text).not.toMatch(/service_role|jeton|Bearer/i)
  })
})
