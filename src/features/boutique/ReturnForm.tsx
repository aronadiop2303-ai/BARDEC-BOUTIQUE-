import { useState } from 'react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney } from '../../domain/hardware/money'
import { cashierExpenseCap } from '../../domain/pos/cashMovements'
import type { ReceiptSnapshot } from '../../domain/pos/receipt'
import {
  buildReturnLines, checkReturnReason, DISPOSITION_LABELS, REFUND_LABELS, returnAllowed,
  type Disposition, type RefundMethod, type ReturnDraftLine,
} from '../../domain/pos/returns'
import { legacyToEffective } from '../../domain/team/roles'
import { getReturnableLines, recordReturn, type CashSession, type SaleDocument } from '../../lib/store/pos'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/**
 * Retour partiel ou total d'une vente : quantités limitées au vendu restant, remise en stock ou casse,
 * remboursement, avoir numéroté imprimable. Montant final calculé par la base (record_return).
 */
export default function ReturnForm({ ctx, sale, session, cashierCap, onDone, onCancel }: {
  ctx: BoutiqueContext
  sale: SaleDocument
  session: CashSession | null
  cashierCap: unknown
  onDone: (snapshot: ReceiptSnapshot, message: string) => void
  onCancel: () => void
}) {
  const lines = useAsync(() => getReturnableLines(ctx.client, sale.order_id as string), [ctx.client, sale.order_id])
  const [draft, setDraft] = useState<Record<string, ReturnDraftLine>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<RefundMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const role = ctx.staffRole ?? legacyToEffective(ctx.access.role)
  const cap = cashierExpenseCap(cashierCap)

  if (lines.status === 'loading') return <Loading />
  if (lines.status === 'error') return <ErrorPanel message={lines.message} onRetry={lines.reload} />

  const available = lines.data
  const entry = (id: string): ReturnDraftLine => draft[id] ?? { order_item_id: id, quantity: '', disposition: 'restock' }
  const set = (id: string, patch: Partial<ReturnDraftLine>) => setDraft((d) => ({ ...d, [id]: { ...entry(id), ...patch } }))
  const built = buildReturnLines(available, available.map((l) => entry(l.order_item_id)))
  const touched = Object.values(draft).some((d) => d.quantity.trim() !== '')
  const problem = !touched ? null
    : !built.ok ? built.message
    : checkReturnReason(reason) ?? returnAllowed(role, built.preview, cap)
      ?? (method === 'cash' && !session ? 'Remboursement en espèces : ouvrez d’abord la caisse.' : null)

  async function submit() {
    if (!built.ok || problem) return
    setBusy(true)
    setError('')
    try {
      const result = await recordReturn(ctx.client, {
        siteId: ctx.siteId, orderId: sale.order_id as string, lines: built.lines, reason, method, sessionId: method === 'cash' ? session?.id ?? null : null,
      })
      onDone(result.snapshot, `Avoir ${result.document_number} : ${formatMoney(Number(result.refund_amount))} remboursé(s) (${REFUND_LABELS[method]}).`)
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : 'Retour impossible.')
      setBusy(false)
    }
  }

  return (
    <div className="bq-card bq-stack" role="group" aria-label={`Retour sur ${sale.document_number}`}>
      <strong>Retour sur {sale.document_number}</strong>
      <div className="bq-table-wrap">
        <table className="bq-table" aria-label="Articles retournables">
          <thead><tr><th scope="col">Article</th><th scope="col" className="num">Vendu</th><th scope="col" className="num">Déjà retourné</th><th scope="col">Quantité retournée</th><th scope="col">Destination</th><th scope="col" className="num">Remboursable / unité</th></tr></thead>
          <tbody>
            {available.map((l) => (
              <tr key={l.order_item_id}>
                <td>{l.product_name}{l.unit_label ? <small className="bq-muted"> · {l.unit_label}</small> : null}</td>
                <td className="num">{l.quantity_sold}</td>
                <td className="num">{l.quantity_returned}</td>
                <td>
                  <input className="bq-qty" inputMode="decimal" aria-label={`Quantité retournée de ${l.product_name}`} disabled={l.quantity_returnable <= 0}
                    value={entry(l.order_item_id).quantity} onChange={(e) => set(l.order_item_id, { quantity: e.target.value })} />
                </td>
                <td>
                  <select aria-label={`Destination de ${l.product_name}`} value={entry(l.order_item_id).disposition}
                    onChange={(e) => set(l.order_item_id, { disposition: e.target.value as Disposition })}>
                    {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>)}
                  </select>
                </td>
                <td className="num">{formatMoney(l.unit_refund)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bq-row">
        <label className="bq-inline-field bq-grow">Motif du retour
          <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="bq-inline-field">Remboursement
          <select value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)}>
            {(Object.keys(REFUND_LABELS) as RefundMethod[]).map((m) => <option key={m} value={m}>{REFUND_LABELS[m]}</option>)}
          </select>
        </label>
      </div>
      {built.ok && <p className="bq-hint">Aperçu : {formatMoney(built.preview)} à rembourser. Montant final calculé par la base.</p>}
      {problem && <p className="bq-error" role="alert">{problem}</p>}
      {error && <p className="bq-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Fermer</button>
        <button className="primary-button" disabled={busy || !built.ok || !!problem} onClick={submit}>{busy ? 'Enregistrement…' : 'Valider le retour et imprimer l’avoir'}</button>
      </div>
    </div>
  )
}
