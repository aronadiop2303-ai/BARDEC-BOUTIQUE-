import { canAssignRole, validateInviteRequest, type EffectiveRole } from '../_shared/team-rules.ts'

/**
 * Invitation d'un membre d'équipe. Le handler ne dépend d'aucun module Deno : il est testé par Vitest
 * (src/domain/team/invite.test.ts) avec de faux clients.
 *
 * Sécurité
 *   - Le jeton de l'appelant est vérifié (getUser) ; son rôle est lu PAR LA BASE avec SON jeton
 *     (current_staff_role), puis recontrôlé par staff_register_invitation.
 *   - La clé service_role n'existe que côté serveur (variable d'environnement de la fonction).
 *   - Nouveau compte : lien d'invitation renvoyé au propriétaire/gérant (à transmettre en privé) ou e-mail envoyé
 *     si INVITE_SEND_EMAIL=true (exige un SMTP configuré).
 *   - Compte existant : AUCUN lien n'est renvoyé (sinon l'appelant pourrait se connecter au compte d'un tiers) ;
 *     la personne se connecte avec ses propres identifiants.
 */

type RpcResult<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>

export type UserClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> }
  rpc: (fn: 'current_staff_role', args: { p_site_id: string }) => RpcResult<string>
}

export type AdminClient = {
  rpc: {
    (fn: 'staff_lookup_user_id', args: { p_email: string }): RpcResult<string>
    (fn: 'staff_register_invitation', args: { p_site_id: string; p_user_id: string; p_staff_role: string; p_invited_by: string }): RpcResult<unknown>
  }
  auth: {
    admin: {
      generateLink: (params: { type: 'invite'; email: string; options?: { redirectTo?: string } }) =>
        Promise<{ data: { user: { id: string } | null; properties: { action_link: string } | null } | null; error: { message: string } | null }>
      inviteUserByEmail: (email: string, options?: { redirectTo?: string }) =>
        Promise<{ data: { user: { id: string } | null } | null; error: { message: string } | null }>
    }
  }
}

export type InviteDeps = {
  userClient: (authorization: string) => UserClient
  adminClient: () => AdminClient
  redirectTo?: string
  sendEmail: boolean
  allowedOrigin: string
}

export type InviteResponse = {
  user_id: string
  existing_account: boolean
  email_sent: boolean
  action_link: string | null
}

export function createInviteHandler(deps: InviteDeps) {
  const headers = {
    'Access-Control-Allow-Origin': deps.allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  const fail = (status: number, message: string) => reply(status, { error: message })

  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return fail(405, 'Méthode non autorisée.')

    const authorization = request.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) return fail(401, 'Connexion requise.')

    let body: unknown
    try { body = await request.json() } catch { return fail(400, 'Requête illisible.') }
    const parsed = validateInviteRequest(body)
    if (!parsed.ok) return fail(400, parsed.message)
    const { site_id, email, staff_role } = parsed.value

    const caller = deps.userClient(authorization)
    const { data: auth, error: authError } = await caller.auth.getUser()
    const callerId = auth?.user?.id
    if (authError || !callerId) return fail(401, 'Session invalide : reconnectez-vous.')

    const role = await caller.rpc('current_staff_role', { p_site_id: site_id })
    if (role.error) return fail(403, 'Rôle introuvable sur cette boutique.')
    if (!canAssignRole((role.data ?? null) as EffectiveRole | null, staff_role)) {
      return fail(403, 'Votre rôle ne permet pas d’attribuer ce rôle.')
    }

    const admin = deps.adminClient()
    const lookup = await admin.rpc('staff_lookup_user_id', { p_email: email })
    if (lookup.error) return fail(500, 'Recherche du compte impossible.')
    let userId = lookup.data ?? null
    const existing = userId !== null
    if (userId === callerId) return fail(400, 'Vous ne pouvez pas vous inviter vous-même.')

    let actionLink: string | null = null
    let emailSent = false
    if (!existing) {
      if (deps.sendEmail) {
        const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: deps.redirectTo })
        if (invited.error || !invited.data?.user) return fail(502, 'Envoi de l’invitation impossible (SMTP ?).')
        userId = invited.data.user.id
        emailSent = true
      } else {
        const link = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: deps.redirectTo } })
        if (link.error || !link.data?.user || !link.data.properties) return fail(502, 'Création du lien d’invitation impossible.')
        userId = link.data.user.id
        actionLink = link.data.properties.action_link
      }
    }

    const registered = await admin.rpc('staff_register_invitation', {
      p_site_id: site_id, p_user_id: userId as string, p_staff_role: staff_role, p_invited_by: callerId,
    })
    if (registered.error) {
      const status = registered.error.code === '42501' ? 403 : registered.error.code === '23505' ? 409 : 400
      return fail(status, registered.error.message)
    }

    const response: InviteResponse = { user_id: userId as string, existing_account: existing, email_sent: emailSent, action_link: actionLink }
    return reply(200, response)
  }
}
