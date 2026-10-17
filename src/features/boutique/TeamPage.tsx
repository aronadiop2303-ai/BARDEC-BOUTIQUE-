import { useState } from 'react'
import { Copy, MessageCircle, UserPlus } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatShopDateTime } from '../../domain/pos/history'
import {
  canAssignRole, canManageMember, legacyToEffective, normalizeEmail, STAFF_ROLE_HINTS, STAFF_ROLE_LABELS, STAFF_ROLES,
  type EffectiveRole, type StaffRole,
} from '../../domain/team/roles'
import { inviteStaff, listStaff, setStaffActive, setStaffRole, TeamNotInstalledError, whatsappInviteUrl, type InviteResult, type StaffMember } from '../../lib/store/team'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

export const NO_SMTP_NOTICE =
  'Sans SMTP dédié, aucun e-mail n’est envoyé : un lien d’invitation personnel est créé, à transmettre vous-même en privé (WhatsApp, SMS).'

/** Équipe : liste, rôle, statut, invitation par lien, changement de rôle, désactivation. */
export default function TeamPage({ ctx }: { ctx: BoutiqueContext }) {
  const me: EffectiveRole = ctx.staffRole ?? legacyToEffective(ctx.access.role)
  const staff = useAsync(async () => {
    try {
      return { installed: true as const, members: await listStaff(ctx.client, ctx.siteId) }
    } catch (error) {
      if (error instanceof TeamNotInstalledError) return { installed: false as const, members: [] as StaffMember[] }
      throw error
    }
  }, [ctx.client, ctx.siteId])

  const heading = <div className="bq-heading"><div><p className="eyebrow">ÉQUIPE</p><h1 className="bq-title">Équipe</h1></div></div>

  if (staff.status === 'loading') return <div className="bq-stack">{heading}<Loading /></div>
  if (staff.status === 'error') return <div className="bq-stack">{heading}<ErrorPanel message={staff.message} onRetry={staff.reload} /></div>
  if (!staff.data.installed) {
    return (
      <div className="bq-stack">
        {heading}
        <p className="bq-error" role="alert">
          La gestion d’équipe n’est pas encore activée : la migration <code>team_accounts</code> n’est pas appliquée à la base.
        </p>
      </div>
    )
  }

  return (
    <div className="bq-stack">
      {heading}
      <InviteForm ctx={ctx} me={me} onInvited={staff.reload} />
      <MemberList ctx={ctx} me={me} members={staff.data.members} onChanged={staff.reload} />
    </div>
  )
}

function InviteForm({ ctx, me, onInvited }: { ctx: BoutiqueContext; me: EffectiveRole; onInvited: () => void }) {
  const roles = STAFF_ROLES.filter((role) => canAssignRole(me, role))
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>(roles.includes('cashier') ? 'cashier' : roles[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState(false)
  const valid = normalizeEmail(email) !== null

  async function invite() {
    setError('')
    setResult(null)
    setCopied(false)
    setBusy(true)
    try {
      setResult(await inviteStaff(ctx.client, ctx.siteId, normalizeEmail(email) as string, role))
      setEmail('')
      onInvited()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invitation impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Inviter un membre">
      <h2 className="bq-subtitle"><UserPlus size={18} /> Inviter un membre</h2>
      <p className="notice" role="note">{NO_SMTP_NOTICE}</p>
      <div className="bq-row">
        <label className="bq-inline-field bq-grow">Adresse e-mail
          <input type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="bq-inline-field">Rôle
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {roles.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <button className="primary-button" disabled={!valid || busy} onClick={invite}>{busy ? 'Invitation…' : 'Inviter'}</button>
      </div>
      <small className="bq-hint">{STAFF_ROLE_HINTS[role]}</small>
      {error && <p className="bq-error" role="alert">{error}</p>}
      {result && (
        <div className="notice bq-stack" role="status">
          {result.existing_account && <span>Cette personne a déjà un compte : elle se connecte avec ses propres identifiants. Aucun lien n’est créé.</span>}
          {result.email_sent && <span>Invitation envoyée par e-mail.</span>}
          {result.action_link && (
            <>
              <span>Lien d’invitation personnel : transmettez-le uniquement à la personne invitée. Il permet d’activer son compte.</span>
              <input readOnly value={result.action_link} aria-label="Lien d’invitation" onFocus={(e) => e.target.select()} />
              <div className="bq-row">
                <button className="secondary-button" onClick={() => copy(result.action_link as string)}><Copy size={15} /> {copied ? 'Copié' : 'Copier le lien'}</button>
                <a className="secondary-button" href={whatsappInviteUrl(ctx.access.site.name, result.action_link)} target="_blank" rel="noreferrer noopener">
                  <MessageCircle size={15} /> Envoyer par WhatsApp
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function MemberList({ ctx, me, members, onChanged }: { ctx: BoutiqueContext; me: EffectiveRole; members: StaffMember[]; onChanged: () => void }) {
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(member: StaffMember, action: () => Promise<void>, done: string) {
    setMessage(null)
    setBusy(member.user_id)
    try {
      await action()
      setMessage({ kind: 'ok', text: done })
      onChanged()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Action impossible.' })
    } finally {
      setBusy(null)
    }
  }

  const name = (m: StaffMember) => m.display_name || m.email || 'Compte sans nom'

  return (
    <section className="bq-card bq-stack" aria-label="Membres de l’équipe">
      <h2 className="bq-subtitle">Membres</h2>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {members.length === 0 ? <Empty title="Aucun membre." /> : (
        <div className="bq-table-wrap">
          <table className="bq-table" aria-label="Équipe">
            <thead><tr><th scope="col">Nom</th><th scope="col">E-mail</th><th scope="col">Rôle</th><th scope="col">Statut</th><th scope="col">Dernière connexion</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {members.map((member) => {
                const manageable = canManageMember(me, ctx.userId, member.user_id, member.staff_role)
                const roles = STAFF_ROLES.filter((r) => canAssignRole(me, r))
                return (
                  <tr key={member.user_id}>
                    <td>{name(member)}{member.user_id === ctx.userId && <small className="bq-muted"> (vous)</small>}</td>
                    <td>{member.email ?? '—'}</td>
                    <td>
                      {manageable && member.is_active ? (
                        <select
                          aria-label={`Rôle de ${name(member)}`} value={member.staff_role} disabled={busy === member.user_id}
                          onChange={(e) => run(member, () => setStaffRole(ctx.client, ctx.siteId, member.user_id, e.target.value as StaffRole), `Rôle de ${name(member)} modifié.`)}
                        >
                          {roles.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : STAFF_ROLE_LABELS[member.staff_role]}
                    </td>
                    <td>{member.is_active ? <span className="bq-badge">Actif</span> : <span className="bq-badge bq-badge-void">Désactivé</span>}</td>
                    <td>{member.last_sign_in_at ? formatShopDateTime(member.last_sign_in_at) : <span className="bq-muted">Jamais connecté</span>}</td>
                    <td>
                      {manageable && member.is_active && (
                        <button className="text-button" disabled={busy === member.user_id}
                          onClick={() => run(member, () => setStaffActive(ctx.client, ctx.siteId, member.user_id, false, ''), `${name(member)} est désactivé(e).`)}>
                          Désactiver
                        </button>
                      )}
                      {manageable && !member.is_active && (
                        <button className="text-button" disabled={busy === member.user_id}
                          onClick={() => run(member, () => setStaffActive(ctx.client, ctx.siteId, member.user_id, true, ''), `${name(member)} est réactivé(e).`)}>
                          Réactiver
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
