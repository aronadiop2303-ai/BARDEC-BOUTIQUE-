import { useEffect, useMemo, useState } from 'react'
import { Plus, Printer, Search, Trash2, X } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { formatQuantity, type Unit } from '../../domain/hardware/units'
import { checkPayments, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../../domain/pos/payments'
import type { ReceiptSnapshot } from '../../domain/pos/receipt'
import { checkDiscount, computeSaleLine, computeTotals, maxDiscountPercent, type OrderDiscount, type SaleLine } from '../../domain/pos/sale'
import {
  closeSession, getOpenSession, getPosSettings, isPosInstalled, listSalesSince, openSession, recordSale, searchSaleProducts,
  sessionSummary, startOfToday, voidSale, type CashSession, type SaleDocument, type SaleProduct, type SessionSummary,
} from '../../lib/store/pos'
import { listUnits } from '../../lib/store/units'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'
import Receipt, { type ReceiptFormat } from './Receipt'

export const MANUAL_PAYMENT_NOTICE = 'Wave / Orange Money : enregistrement manuel, aucun paiement réel n’est exécuté.'

type PrintJob = { snapshot: ReceiptSnapshot; format: ReceiptFormat; voided: boolean }

/** Ventes et caisse : session, panier, encaissement par public.record_sale, historique du jour. */
export default function PosPage({ ctx }: { ctx: BoutiqueContext }) {
  const data = useAsync(async () => {
    const installed = await isPosInstalled(ctx.client)
    if (!installed) return { installed: false as const }
    const [session, units, settings, sales] = await Promise.all([
      getOpenSession(ctx.client, ctx.siteId),
      listUnits(ctx.client, ctx.siteId),
      getPosSettings(ctx.client, ctx.siteId),
      listSalesSince(ctx.client, ctx.siteId, startOfToday()),
    ])
    return { installed: true as const, session, units, settings, sales }
  }, [ctx.client, ctx.siteId])
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)

  useEffect(() => {
    if (!printJob) return
    const timer = setTimeout(() => window.print(), 0)
    return () => clearTimeout(timer)
  }, [printJob])

  const heading = (
    <div className="bq-heading"><div><p className="eyebrow">VENTES</p><h1 className="bq-title">Ventes et caisse</h1></div></div>
  )
  const manualNotice = <p className="notice" role="note">{MANUAL_PAYMENT_NOTICE}</p>

  if (data.status === 'loading') return <div className="bq-stack">{heading}<Loading /></div>
  if (data.status === 'error') return <div className="bq-stack">{heading}<ErrorPanel message={data.message} onRetry={data.reload} /></div>

  if (!data.data.installed) {
    return (
      <div className="bq-stack">
        {heading}
        {manualNotice}
        <p className="bq-error" role="alert">
          Les ventes en caisse ne sont pas encore activées : la migration <code>pos_sales_foundation</code> n’est pas appliquée à la base.
          Aucune vente ne peut être enregistrée tant que le propriétaire ne l’a pas autorisée.
        </p>
        <fieldset className="bq-checklist" disabled aria-label="Caisse désactivée">
          <button className="primary-button" type="button">Ouvrir la caisse</button>
        </fieldset>
      </div>
    )
  }

  const { session, units, settings, sales } = data.data
  const print = (snapshot: ReceiptSnapshot, format: ReceiptFormat, voided = false) => setPrintJob({ snapshot, format, voided })

  return (
    <div className="bq-stack">
      {heading}
      {manualNotice}
      {!ctx.can.sell && <p className="notice" role="status">Consultation seule : seuls le propriétaire, un administrateur ou un vendeur encaissent.</p>}
      {ctx.can.sell && !session && <OpenSessionForm ctx={ctx} onOpened={data.reload} />}
      {session && <SessionBar ctx={ctx} session={session} onClosed={data.reload} />}
      {ctx.can.sell && session && (
        <SaleForm ctx={ctx} session={session} units={units} editorLimit={settings.editorMaxDiscountPercent} onSold={data.reload} onPrint={print} />
      )}
      <SalesHistory ctx={ctx} sales={sales} onChanged={data.reload} onPrint={print} />
      {printJob && (
        <div className="print-root" aria-hidden="true">
          <Receipt snapshot={printJob.snapshot} format={printJob.format} voided={printJob.voided} />
        </div>
      )}
    </div>
  )
}

// ── Ouverture et clôture ─────────────────────────────────────────────────────

function OpenSessionForm({ ctx, onOpened }: { ctx: BoutiqueContext; onOpened: () => void }) {
  const [amount, setAmount] = useState('0')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function open() {
    setError('')
    const value = parseMoney(amount)
    if (value === null) { setError('Fond de caisse invalide.'); return }
    setBusy(true)
    try {
      await openSession(ctx.client, ctx.siteId, ctx.userId, value, note)
      onOpened()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ouverture impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card">
      <h2 className="bq-subtitle">Ouvrir la caisse</h2>
      {error && <p className="bq-error" role="alert">{error}</p>}
      <div className="bq-row">
        <label className="bq-inline-field">Fond de caisse (FCFA)
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="bq-inline-field bq-grow">Note (facultatif)
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="primary-button" disabled={busy} onClick={open}>Ouvrir la caisse</button>
      </div>
    </section>
  )
}

function SessionBar({ ctx, session, onClosed }: { ctx: BoutiqueContext; session: CashSession; onClosed: () => void }) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [closing, setClosing] = useState(false)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canClose = ctx.can.voidSales || session.opened_by === ctx.userId

  async function run(action: () => Promise<SessionSummary>, after?: () => void) {
    setError('')
    setBusy(true)
    try {
      setSummary(await action())
      after?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.')
    } finally {
      setBusy(false)
    }
  }

  function close() {
    const value = parseMoney(counted)
    if (value === null) { setError('Montant compté invalide.'); return }
    run(() => closeSession(ctx.client, session.id, value, note), () => setClosing(false))
  }

  return (
    <section className="bq-card" aria-label="Session de caisse">
      <div className="bq-row">
        <strong className="bq-grow">
          {session.register_name} · ouverte le {new Date(session.opened_at).toLocaleString('fr-FR')} · fond {formatMoney(session.opening_cash)}
        </strong>
        <button className="secondary-button" disabled={busy} onClick={() => run(() => sessionSummary(ctx.client, session.id))}>Rapport X</button>
        {canClose && <button className="secondary-button" disabled={busy} onClick={() => setClosing(true)}>Clôturer (Z)</button>}
      </div>
      {error && <p className="bq-error" role="alert">{error}</p>}
      {closing && (
        <div className="bq-row">
          <label className="bq-inline-field">Espèces comptées (FCFA)
            <input inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </label>
          <label className="bq-inline-field bq-grow">Note de clôture
            <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="primary-button" disabled={busy} onClick={close}>Confirmer la clôture</button>
          <button className="secondary-button" onClick={() => setClosing(false)}>Annuler</button>
        </div>
      )}
      {summary && <SummaryView summary={summary} onDone={summary.status !== 'open' ? onClosed : undefined} />}
    </section>
  )
}

function SummaryView({ summary, onDone }: { summary: SessionSummary; onDone?: () => void }) {
  const money = (value: number | null) => (value === null ? '—' : formatMoney(Number(value), summary.currency))
  return (
    <div className="bq-stack" aria-label={summary.status === 'open' ? 'Rapport X' : 'Rapport Z'}>
      <h3 className="bq-subtitle">{summary.status === 'open' ? 'Rapport X (session en cours)' : 'Rapport Z (clôture)'}</h3>
      <table className="bq-table">
        <tbody>
          <tr><th scope="row">Ventes</th><td className="num">{summary.sales_count} (annulées : {summary.voided_count})</td></tr>
          {Object.entries(summary.by_method).map(([method, total]) => (
            <tr key={method}><th scope="row">{PAYMENT_LABELS[method as PaymentMethod] ?? method}</th><td className="num">{money(total.amount)} ({total.count})</td></tr>
          ))}
          <tr><th scope="row">Fond de caisse</th><td className="num">{money(summary.opening_cash)}</td></tr>
          <tr><th scope="row">Entrées / sorties d’espèces</th><td className="num">+{money(summary.cash_in)} / −{money(summary.cash_out)}</td></tr>
          <tr><th scope="row">Espèces attendues</th><td className="num"><strong>{money(summary.expected_cash)}</strong></td></tr>
          {summary.counted_cash !== null && <tr><th scope="row">Espèces comptées</th><td className="num">{money(summary.counted_cash)}</td></tr>}
          {summary.discrepancy !== null && <tr><th scope="row">Écart</th><td className="num"><strong>{money(summary.discrepancy)}</strong></td></tr>}
        </tbody>
      </table>
      {Number(summary.corrections_excluded) > 0 && <p className="bq-hint">Corrections non comptées dans l’attendu : {money(summary.corrections_excluded)}.</p>}
      {onDone && <button className="primary-button" onClick={onDone}>Terminer</button>}
    </div>
  )
}

// ── Panier et encaissement ───────────────────────────────────────────────────

type CartLine = { key: number; product: SaleProduct; unitId: string; quantity: string; discount: string }
type PaymentDraft = { key: number; method: PaymentMethod; amount: string; reference: string }

const parseQuantity = (text: string) => {
  const value = Number(text.replace(',', '.').trim())
  return text.trim() === '' || !Number.isFinite(value) ? NaN : value
}

let nextKey = 1

function SaleForm({ ctx, session, units, editorLimit, onSold, onPrint }: {
  ctx: BoutiqueContext
  session: CashSession
  units: Unit[]
  editorLimit: unknown
  onSold: () => void
  onPrint: (snapshot: ReceiptSnapshot, format: ReceiptFormat) => void
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 250)
  const results = useAsync(() => searchSaleProducts(ctx.client, ctx.siteId, debounced), [ctx.client, ctx.siteId, debounced])
  const [cart, setCart] = useState<CartLine[]>([])
  const [payments, setPayments] = useState<PaymentDraft[]>([{ key: nextKey++, method: 'cash', amount: '', reference: '' }])
  const [discount, setDiscount] = useState<{ type: 'amount' | 'percent'; value: string; reason: string }>({ type: 'amount', value: '', reason: '' })
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastSale, setLastSale] = useState<{ number: string; snapshot: ReceiptSnapshot; change: number } | null>(null)

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const limit = maxDiscountPercent(ctx.access.role, editorLimit)

  function add(product: SaleProduct) {
    const sell = product.sellUnits.find((u) => u.is_default) ?? product.sellUnits.find((u) => u.conversion_to_base === 1) ?? product.sellUnits[0]
    if (!sell) { setError(`« ${product.name} » n’a aucune unité de vente : complétez sa fiche produit.`); return }
    setError('')
    setCart((lines) => [...lines, { key: nextKey++, product, unitId: sell.unit_id, quantity: String(sell.min_sale_quantity), discount: '' }])
    setSearch('')
  }

  const computed = cart.map((line) => {
    const sell = line.product.sellUnits.find((u) => u.unit_id === line.unitId)
    const unit = unitById.get(line.unitId)
    if (!sell || !unit) return { line, result: { ok: false as const, message: 'Unité inconnue.' } }
    const lineDiscount = line.discount.trim() === '' ? 0 : parseMoney(line.discount) ?? NaN
    return {
      line, unit,
      result: computeSaleLine({ basePrice: line.product.price, sellUnit: sell, unit, tiers: line.product.tiers, quantity: parseQuantity(line.quantity), lineDiscount }),
    }
  })
  const validLines = computed.flatMap((c) => (c.result.ok ? [c.result.line] : [])) as SaleLine[]
  const allValid = computed.length > 0 && validLines.length === computed.length
  const discountValue = discount.value.trim() === '' ? 0 : Number(discount.value.replace(',', '.'))
  const orderDiscount: OrderDiscount = discountValue > 0 ? { type: discount.type, value: discountValue, reason: discount.reason.trim() } : null
  const totals = computeTotals(validLines, orderDiscount)
  const discountError = totals.ok ? checkDiscount(totals.totals, limit, discount.reason) : totals.message
  const paymentInputs = payments.map((p) => ({ method: p.method, amount: parseMoney(p.amount) ?? NaN, reference: p.reference.trim() || undefined }))
  const hasCustomer = !!customer.name.trim() || !!customer.phone.trim()
  const paymentCheck = totals.ok ? checkPayments(totals.totals.grandTotal, paymentInputs, { hasCustomer }) : null
  const ready = allValid && totals.ok && !discountError && paymentCheck?.ok === true

  async function checkout() {
    if (!ready) return
    setError('')
    setBusy(true)
    try {
      const result = await recordSale(ctx.client, {
        siteId: ctx.siteId,
        sessionId: session.id,
        lines: cart.map((line) => ({
          product_id: line.product.id,
          unit_id: line.unitId,
          quantity: parseQuantity(line.quantity),
          ...(line.discount.trim() ? { discount: parseMoney(line.discount) ?? 0 } : {}),
        })),
        payments: paymentInputs,
        customer,
        discount: orderDiscount,
      })
      setLastSale({ number: result.document_number, snapshot: result.snapshot, change: Number(result.change_given) })
      setCart([])
      setPayments([{ key: nextKey++, method: 'cash', amount: '', reference: '' }])
      setDiscount({ type: 'amount', value: '', reason: '' })
      setCustomer({ name: '', phone: '' })
      onSold()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Encaissement impossible.')
    } finally {
      setBusy(false)
    }
  }

  const updateLine = (key: number, patch: Partial<CartLine>) => setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const updatePayment = (key: number, patch: Partial<PaymentDraft>) => setPayments((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  return (
    <section className="bq-card bq-stack" aria-label="Nouvelle vente">
      <h2 className="bq-subtitle">Nouvelle vente</h2>
      {lastSale && (
        <div className="notice bq-row" role="status">
          <span className="bq-grow">Vente enregistrée : {lastSale.number}. Monnaie à rendre : {formatMoney(lastSale.change)}.</span>
          <button className="secondary-button" onClick={() => onPrint(lastSale.snapshot, 'ticket')}><Printer size={15} /> Ticket 80 mm</button>
          <button className="secondary-button" onClick={() => onPrint(lastSale.snapshot, 'a4')}><Printer size={15} /> Reçu A4</button>
        </div>
      )}

      <label className="search-box bq-search">
        <Search size={17} />
        <input
          aria-label="Rechercher un produit ou scanner un code-barres"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || results.status !== 'ready') return
            const exact = results.data.find((p) => p.barcode && p.barcode === search.trim())
            if (exact) add(exact)
          }}
          placeholder="Nom, référence ou code-barres…"
        />
      </label>
      {debounced && results.status === 'ready' && results.data.length === 0 && <p className="bq-hint">Aucun produit actif ne correspond.</p>}
      {debounced && results.status === 'error' && <p className="bq-error" role="alert">{results.message}</p>}
      {debounced && results.status === 'ready' && results.data.length > 0 && (
        <ul className="bq-tree" aria-label="Résultats">
          {results.data.map((product) => (
            <li key={product.id} className="bq-row">
              <span className="bq-grow">{product.name}{product.sku ? <small className="bq-muted"> · {product.sku}</small> : null}</span>
              <span className="bq-muted">{formatMoney(product.price)}</span>
              <button className="secondary-button" onClick={() => add(product)}><Plus size={15} /> Ajouter</button>
            </li>
          ))}
        </ul>
      )}

      {cart.length === 0 ? <Empty title="Panier vide">Recherchez un produit pour l’ajouter.</Empty> : (
        <div className="bq-table-wrap">
          <table className="bq-table" aria-label="Panier">
            <thead>
              <tr><th scope="col">Produit</th><th scope="col">Unité</th><th scope="col">Quantité</th>{limit > 0 && <th scope="col">Remise</th>}<th scope="col" className="num">Montant</th><th scope="col"><span className="sr-only">Retirer</span></th></tr>
            </thead>
            <tbody>
              {computed.map(({ line, result }) => (
                <tr key={line.key}>
                  <td>
                    {line.product.name}
                    {!result.ok && <small className="bq-error" role="alert">{result.message}</small>}
                    {result.ok && result.line.tier && <small className="bq-muted"> · palier dès {formatQuantity(result.line.tier.min_quantity)}</small>}
                  </td>
                  <td>
                    <select aria-label={`Unité de ${line.product.name}`} value={line.unitId} onChange={(e) => updateLine(line.key, { unitId: e.target.value })}>
                      {line.product.sellUnits.map((u) => <option key={u.unit_id} value={u.unit_id}>{unitById.get(u.unit_id)?.label ?? 'Unité'}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="bq-qty" aria-label={`Quantité de ${line.product.name}`} inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                  </td>
                  {limit > 0 && (
                    <td><input className="bq-qty" aria-label={`Remise sur ${line.product.name}`} inputMode="numeric" value={line.discount} onChange={(e) => updateLine(line.key, { discount: e.target.value })} /></td>
                  )}
                  <td className="num">{result.ok ? formatMoney(result.line.total) : '—'}</td>
                  <td><button className="text-button" aria-label={`Retirer ${line.product.name}`} onClick={() => setCart((lines) => lines.filter((l) => l.key !== line.key))}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {limit > 0 && (
        <div className="bq-row" aria-label="Remise globale">
          <label className="bq-inline-field">Remise
            <select value={discount.type} onChange={(e) => setDiscount({ ...discount, type: e.target.value as 'amount' | 'percent' })}>
              <option value="amount">Montant (FCFA)</option>
              <option value="percent">Pourcentage</option>
            </select>
          </label>
          <label className="bq-inline-field">Valeur
            <input inputMode="decimal" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} />
          </label>
          <label className="bq-inline-field bq-grow">Motif de la remise
            <input maxLength={200} value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} />
          </label>
          <small className="bq-hint">Limite de votre rôle : {limit} %. Vérifiée par la base.</small>
        </div>
      )}

      <div className="bq-row" aria-label="Client">
        <label className="bq-inline-field bq-grow">Client (facultatif)
          <input maxLength={120} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
        </label>
        <label className="bq-inline-field">Téléphone
          <input maxLength={40} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
        </label>
      </div>

      <div className="bq-stack" aria-label="Paiements">
        {payments.map((payment, index) => (
          <div className="bq-row" key={payment.key}>
            <label className="bq-inline-field">Moyen
              <select aria-label={`Moyen de paiement ${index + 1}`} value={payment.method} onChange={(e) => updatePayment(payment.key, { method: e.target.value as PaymentMethod })}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
              </select>
            </label>
            <label className="bq-inline-field">{payment.method === 'cash' ? 'Montant remis' : 'Montant'}
              <input aria-label={`Montant du paiement ${index + 1}`} inputMode="numeric" value={payment.amount} onChange={(e) => updatePayment(payment.key, { amount: e.target.value })} />
            </label>
            {payment.method !== 'cash' && payment.method !== 'credit' && (
              <label className="bq-inline-field bq-grow">Référence (facultatif)
                <input maxLength={100} value={payment.reference} onChange={(e) => updatePayment(payment.key, { reference: e.target.value })} />
              </label>
            )}
            {payments.length > 1 && (
              <button className="text-button" aria-label={`Retirer le paiement ${index + 1}`} onClick={() => setPayments((list) => list.filter((p) => p.key !== payment.key))}><X size={15} /></button>
            )}
          </div>
        ))}
        <button className="text-button" onClick={() => setPayments((list) => [...list, { key: nextKey++, method: 'wave', amount: '', reference: '' }])}>
          <Plus size={15} /> Ajouter un moyen de paiement
        </button>
      </div>

      <dl className="bq-sale-totals">
        <div><dt>Total</dt><dd>{totals.ok ? formatMoney(totals.totals.grandTotal) : '—'}</dd></div>
        {paymentCheck?.ok && <div><dt>Monnaie à rendre</dt><dd>{formatMoney(paymentCheck.change)}</dd></div>}
      </dl>
      <p className="bq-hint">Montants indicatifs : la base recalcule les prix enregistrés au moment de l’encaissement.</p>
      {discountError && cart.length > 0 && <p className="bq-error" role="alert">{discountError}</p>}
      {paymentCheck && !paymentCheck.ok && allValid && <p className="bq-error" role="alert">{paymentCheck.message}</p>}
      {error && <p className="bq-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="primary-button" disabled={!ready || busy} onClick={checkout}>{busy ? 'Encaissement…' : 'Encaisser'}</button>
      </div>
    </section>
  )
}

// ── Historique du jour ───────────────────────────────────────────────────────

function SalesHistory({ ctx, sales, onChanged, onPrint }: {
  ctx: BoutiqueContext
  sales: SaleDocument[]
  onChanged: () => void
  onPrint: (snapshot: ReceiptSnapshot, format: ReceiptFormat, voided?: boolean) => void
}) {
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirmVoid(sale: SaleDocument) {
    if (!sale.order_id) return
    setMessage(null)
    setBusy(true)
    try {
      const result = await voidSale(ctx.client, sale.order_id, reason)
      const cash = result.cash_session_closed ? ' Session de caisse déjà fermée : le remboursement en espèces n’a pas été inscrit en caisse.' : ''
      setMessage({ kind: 'ok', text: `Vente ${sale.document_number} annulée, stock rétabli.${cash}` })
      setVoiding(null)
      setReason('')
      onChanged()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Annulation impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Ventes du jour">
      <h2 className="bq-subtitle">Ventes du jour</h2>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {sales.length === 0 ? <Empty title="Aucune vente aujourd’hui." /> : (
        <div className="bq-table-wrap">
          <table className="bq-table">
            <thead><tr><th scope="col">Numéro</th><th scope="col">Heure</th><th scope="col" className="num">Total</th><th scope="col">État</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.document_number}</td>
                  <td>{new Date(sale.issued_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="num">{formatMoney(sale.total_amount)}</td>
                  <td>{sale.status === 'void' ? <span className="bq-badge" title={sale.void_reason ?? ''}>Annulée</span> : <span className="bq-badge">Émise</span>}</td>
                  <td>
                    {sale.snapshot && (
                      <>
                        <button className="text-button" onClick={() => onPrint(sale.snapshot!, 'ticket', sale.status === 'void')}>Réimprimer</button>
                        <button className="text-button" onClick={() => onPrint(sale.snapshot!, 'a4', sale.status === 'void')}>A4</button>
                      </>
                    )}
                    {ctx.can.voidSales && sale.status !== 'void' && voiding !== sale.id && (
                      <button className="text-button" onClick={() => { setVoiding(sale.id); setReason('') }}>Annuler</button>
                    )}
                    {voiding === sale.id && (
                      <div className="bq-row">
                        <input className="name-input bq-grow" aria-label={`Motif d’annulation de ${sale.document_number}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif obligatoire" />
                        <button className="primary-button" disabled={busy || reason.trim().length < 3} onClick={() => confirmVoid(sale)}>Confirmer l’annulation</button>
                        <button className="secondary-button" onClick={() => setVoiding(null)}>Retour</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
