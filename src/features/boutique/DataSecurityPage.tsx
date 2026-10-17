import { useState } from 'react'
import { Download, LogOut } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney } from '../../domain/hardware/money'
import { formatShopDateTime } from '../../domain/pos/history'
import { auditLabel, describeUserAgent, exportSummary, tableToCsv, type ExportPayload } from '../../domain/security/security'
import { auditLog, downloadText, exportSiteData, mySessions, SecurityNotInstalledError, signOutOtherSessions, type AuditEntry } from '../../lib/store/security'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

type Tab = 'export' | 'audit' | 'sessions'

/** Données et sécurité : export complet (propriétaire), journal d'audit (propriétaire, gérant), mes sessions (tous). */
export default function DataSecurityPage({ ctx }: { ctx: BoutiqueContext }) {
  const tabs: { key: Tab; label: string }[] = [
    ...(ctx.can.exportData ? [{ key: 'export' as const, label: 'Export des données' }] : []),
    ...(ctx.can.auditLog ? [{ key: 'audit' as const, label: 'Journal d’audit' }] : []),
    { key: 'sessions', label: 'Mes sessions' },
  ]
  const [tab, setTab] = useState<Tab>(tabs[0].key)
  return (
    <div className="bq-stack">
      <div className="bq-heading"><div><p className="eyebrow">SÉCURITÉ</p><h1 className="bq-title">Données et sécurité</h1></div></div>
      <div className="bq-row" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'primary-button' : 'secondary-button'} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab === 'export' && <ExportPanel ctx={ctx} />}
      {tab === 'audit' && <AuditPanel ctx={ctx} />}
      {tab === 'sessions' && <SessionsPanel ctx={ctx} />}
    </div>
  )
}

const notInstalled = (message: string) => message === new SecurityNotInstalledError().message

function ExportPanel({ ctx }: { ctx: BoutiqueContext }) {
  const [payload, setPayload] = useState<ExportPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stamp = new Date().toISOString().slice(0, 10)

  async function run() {
    setBusy(true)
    setError('')
    try {
      setPayload(await exportSiteData(ctx.client, ctx.siteId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Export des données">
      <p className="bq-hint">
        Toutes les données de la boutique, table par table (produits, stock, ventes, caisse, clients, fournisseurs, journaux).
        Exclus : comptes d’authentification, mots de passe, jetons, sessions. Fichier à conserver en lieu sûr : il contient
        les données de vos clients.
      </p>
      <div><button className="primary-button" disabled={busy} onClick={run}>{busy ? 'Préparation…' : 'Préparer l’export'}</button></div>
      {error && <p className="bq-error" role="alert">{error}</p>}
      {payload && (
        <>
          <div className="bq-row">
            <button className="secondary-button" onClick={() => downloadText(`export-boutique-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json')}>
              <Download size={15} /> Tout télécharger (JSON)
            </button>
          </div>
          {payload.truncated_tables.length > 0 && (
            <p className="bq-error" role="alert">Tables limitées à {payload.row_limit_per_table} lignes : {payload.truncated_tables.join(', ')}. Export incomplet pour ces tables.</p>
          )}
          <table className="bq-table" aria-label="Tables exportées">
            <thead><tr><th scope="col">Table</th><th scope="col" className="num">Lignes</th><th scope="col">CSV</th></tr></thead>
            <tbody>
              {exportSummary(payload).map((t) => (
                <tr key={t.table}>
                  <td>{t.table}{t.truncated && <small className="bq-error"> (limitée)</small>}</td>
                  <td className="num">{t.rows}</td>
                  <td><button className="text-button" disabled={t.rows === 0} aria-label={`Télécharger ${t.table} en CSV`}
                    onClick={() => downloadText(`${t.table}-${stamp}.csv`, tableToCsv(payload.tables[t.table]), 'text/csv;charset=utf-8')}>CSV</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

function AuditPanel({ ctx }: { ctx: BoutiqueContext }) {
  const [pages, setPages] = useState<string | null>(null)
  const data = useAsync(() => auditLog(ctx.client, ctx.siteId, pages), [ctx.client, ctx.siteId, pages])
  const [rows, setRows] = useState<AuditEntry[]>([])
  const shown = data.status === 'ready' ? [...rows, ...data.data] : rows

  if (data.status === 'error') {
    return notInstalled(data.message) ? <p className="bq-error" role="alert">{data.message}</p> : <ErrorPanel message={data.message} onRetry={data.reload} />
  }
  return (
    <section className="bq-card bq-stack" aria-label="Journal d’audit">
      <p className="bq-hint">Qui a fait quoi : nom affiché de l’auteur, action, référence. Aucun téléphone, e-mail ni adresse.</p>
      {data.status === 'loading' && rows.length === 0 && <Loading />}
      {shown.length === 0 && data.status === 'ready' ? <Empty title="Aucune action enregistrée." /> : (
        <table className="bq-table" aria-label="Actions">
          <thead><tr><th scope="col">Date</th><th scope="col">Auteur</th><th scope="col">Domaine</th><th scope="col">Action</th><th scope="col">Référence</th><th scope="col" className="num">Montant / quantité</th></tr></thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.occurred_at}-${i}`}>
                <td>{formatShopDateTime(e.occurred_at)}</td>
                <td>{e.actor_name ?? '—'}</td>
                <td>{e.category}</td>
                <td>{auditLabel(e.action)}</td>
                <td>{e.reference ?? '—'}</td>
                <td className="num">{e.amount === null ? '' : e.category === 'Stock' ? e.amount : formatMoney(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.status === 'ready' && data.data.length === 100 && (
        <button className="secondary-button" onClick={() => { setRows(shown); setPages(data.data[data.data.length - 1].occurred_at) }}>Plus ancien</button>
      )}
    </section>
  )
}

function SessionsPanel({ ctx }: { ctx: BoutiqueContext }) {
  const sessions = useAsync(() => mySessions(ctx.client), [ctx.client])
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function others() {
    try {
      await signOutOtherSessions(ctx.client)
      setMessage({ kind: 'ok', text: 'Vos autres sessions sont déconnectées. Celle-ci reste ouverte.' })
      sessions.reload()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Déconnexion impossible.' })
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Mes sessions">
      <p className="bq-hint">Vos connexions actives (les vôtres seulement). Une session inconnue : déconnectez les autres et changez de mot de passe.</p>
      {sessions.status === 'loading' && <Loading />}
      {sessions.status === 'error' && (notInstalled(sessions.message) ? <p className="bq-error" role="alert">{sessions.message}</p> : <ErrorPanel message={sessions.message} onRetry={sessions.reload} />)}
      {sessions.status === 'ready' && (sessions.data.length === 0 ? <Empty title="Aucune session lisible." /> : (
        <table className="bq-table" aria-label="Sessions">
          <thead><tr><th scope="col">Appareil</th><th scope="col">Ouverte le</th><th scope="col">Dernière activité</th><th scope="col">Adresse IP</th></tr></thead>
          <tbody>{sessions.data.map((s) => (
            <tr key={s.session_id}><td>{describeUserAgent(s.user_agent)}</td><td>{formatShopDateTime(s.created_at)}</td><td>{formatShopDateTime(s.last_activity_at)}</td><td>{s.ip ?? '—'}</td></tr>
          ))}</tbody>
        </table>
      ))}
      <div><button className="secondary-button" onClick={others}><LogOut size={15} /> Déconnecter mes autres sessions</button></div>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
    </section>
  )
}
