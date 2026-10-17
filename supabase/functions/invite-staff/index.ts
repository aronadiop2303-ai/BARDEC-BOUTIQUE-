// Edge Function invite-staff — PRÉPARÉE, NON DÉPLOYÉE, NON TESTÉE EN EXÉCUTION.
// Déploiement (configuration : exige l'autorisation écrite du propriétaire) :
//   supabase functions deploy invite-staff
// Variables : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (fournies par Supabase),
//   INVITE_REDIRECT_TO (URL de l'application, à ajouter aux URL de redirection autorisées d'Auth),
//   INVITE_SEND_EMAIL=true seulement si un SMTP dédié est configuré, ALLOWED_ORIGIN (origine de l'application).
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createInviteHandler, type AdminClient, type UserClient } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const handler = createInviteHandler({
  userClient: (authorization) =>
    createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }) as unknown as UserClient,
  adminClient: () =>
    createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as AdminClient,
  redirectTo: Deno.env.get('INVITE_REDIRECT_TO') || undefined,
  sendEmail: Deno.env.get('INVITE_SEND_EMAIL') === 'true',
  allowedOrigin: Deno.env.get('ALLOWED_ORIGIN') || 'null',
})

Deno.serve(handler)
