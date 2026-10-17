import { useState } from 'react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { allowedCashTypes, CASH_DIRECTION, CASH_MOVEMENT_LABELS, cashierExpenseCap, checkCashMovement, type ManualCashType } from '../../domain/pos/cashMovements'
import { formatShopDateTime } from '../../domain/pos/history'
import { legacyToEffective } from '../../domain/team/roles'
import { listSessionMovements, recordCashMovement, sessionSummary, type CashSession } from '../../lib/store/pos'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

const TYPE_LABELS: Record<ManualCashType, string> = {
  expense: 'Dépense',
  cash_in: 'Apport (entrée d’espèces)',
  cash_out: 'Retrait (sortie d’espèces)',
  deposit: 'Dépôt en banque',
}

/**
 * Mouvements de caisse de la session ouverte : formulaire (public.record_cash_movement) et liste.
 * L'attendu affiché est celui du rapport X calculé par la base, jamais recalculé ici.
 */
export default function CashMovementsPanel(props: { ctx: BoutiqueContext; session: CashSession; cashierCap: unknown; onRecorded?: () => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <section className="bq-card bq-row" aria-label="Mouvements de caisse">
        <h2 className="bq-subtitle bq-grow">Mouvements de caisse</h2>
        <button className="secondary-button" onClick={() => setOpen(true)}>Dépense, apport, retrait, dépôt…</button>
      </section>
    )
  }
  return <CashMovementsBody {...props} onClose={() => setOpen(false)} />
}

function CashMovementsBody({ ctx, session, cashierCap, onRecorded, onClose }: {
  ctx: BoutiqueContext
  session: CashSession
  cashierCap: unknown
  onRecorded?: () => void
  onClose: () => void
}) {
  const role = ctx.staffRole ?? legacyToEffective(ctx.access.role)
  const types = allowedCashTypes(role)
  const cap = cashierExpenseCap(cashierCap)
  const [refresh, setRefresh] = useState(0)
  const data = useAsync(async () => {
    const [movements, summary] = await Promise.all([listSessionMovements(ctx.client, session.id), sessionSummary(ctx.client, session.id)])
    return { movements, expected: Number(summary.expected_cash) }
  }, [ctx.client, session.id, refresh])
  const [type, setType] = useState<ManualCashType>(types[0] ?? 'expense')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [receiptRef, setReceiptRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const value = parseMoney(amount)
  const expected = data.status === 'ready' ? data.data.expected : null
  const problem = amount.trim() === '' ? null : value === null
    ? 'Montant invalide : saisissez un montant entier en FCFA.'
    : checkCashMovement({ type, amount: value, reason, receiptRef }, { role, cashierCap: cap, expectedCash: expected })
  const ready = value !== null && !problem && reason.trim().length >= 3

  async function submit() {
    if (!ready || value === null) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await recordCashMovement(ctx.client, { siteId: ctx.siteId, sessionId: session.id, type, amount: value, reason, receiptRef })
      setMessage({ kind: 'ok', text: `${TYPE_LABELS[type]} de ${formatMoney(value)} enregistré(e). Espèces attendues : ${formatMoney(Number(result.expected_cash))}.` })
      setAmount('')
      setReason('')
      setReceiptRef('')
      setRefresh((n) => n + 1)
      onRecorded?.()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Enregistrement impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Mouvements de caisse">
      <div className="bq-row">
        <h2 className="bq-subtitle bq-grow">Mouvements de caisse</h2>
        <button className="text-button" onClick={onClose}>Replier</button>
      </div>
      {types.length === 0 ? <p className="notice" role="note">Votre rôle ne permet pas d’enregistrer de mouvement de caisse.</p> : (
        <>
          <div className="bq-row">
            <label className="bq-inline-field">Type
              <select value={type} onChange={(e) => setType(e.target.value as ManualCashType)}>
                {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </label>
            <label className="bq-inline-field">Montant (FCFA)
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="bq-inline-field bq-grow">Motif (obligatoire)
              <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="bq-inline-field">Justificatif (n° de reçu, facultatif)
              <input maxLength={100} value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />
            </label>
            <button className="primary-button" disabled={!ready || busy} onClick={submit}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
          {role === 'cashier' && <small className="bq-hint">Vendeur : petites dépenses seulement, {cap > 0 ? `${formatMoney(cap)} au plus` : 'aucune autorisée (plafond à 0)'}. Vérifié par la base.</small>}
          {problem && <p className="bq-error" role="alert">{problem}</p>}
        </>
      )}
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {data.status === 'loading' && <Loading />}
      {data.status === 'error' && <ErrorPanel message={data.message} onRetry={data.reload} />}
      {data.status === 'ready' && (
        <>
          <p className="bq-hint">Espèces attendues (rapport X, calcul de la base) : <strong>{formatMoney(data.data.expected)}</strong></p>
          {data.data.movements.length === 0 ? <Empty title="Aucun mouvement dans cette session." /> : (
            <div className="bq-table-wrap">
              <table className="bq-table" aria-label="Mouvements de la session">
                <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col" className="num">Montant</th><th scope="col">Motif</th><th scope="col">Justificatif</th></tr></thead>
                <tbody>
                  {data.data.movements.map((m) => (
                    <tr key={m.id}>
                      <td>{formatShopDateTime(m.created_at)}</td>
                      <td>{CASH_MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}</td>
                      <td className="num">{CASH_DIRECTION[m.movement_type] === -1 ? '−' : CASH_DIRECTION[m.movement_type] === 1 ? '+' : ''}{formatMoney(m.amount)}</td>
                      <td>{m.reason ?? '—'}</td>
                      <td>{m.receipt_ref ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
