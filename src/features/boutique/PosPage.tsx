import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Plus, Printer, Search, Trash2, X } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { formatQuantity, type Unit } from '../../domain/hardware/units'
import { checkPayments, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../../domain/pos/payments'
import { dayRange, formatShopDateTime, normalizeNumberSearch, paymentModes, sellerName, shopToday } from '../../domain/pos/history'
import type { ReceiptSnapshot } from '../../domain/pos/receipt'
import { checkDiscount, computeSaleLine, computeTotals, maxDiscountPercent, type OrderDiscount, type SaleLine } from '../../domain/pos/sale'
import {
  closeSession, getOpenSession, getPosSettings, isPosInstalled, listSales, openSession, recordSale, SALES_HISTORY_LIMIT, searchSaleProducts,
  sessionBreakdown, sessionSummary, voidSale, type CashSession, type SaleDocument, type SaleProduct, type SaleResult, type SessionSummary,
} from '../../lib/store/pos'
import { listUnits } from '../../lib/store/units'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'
import CashMovementsPanel from './CashMovementsPanel'
import CreditCustomerPicker from './CreditCustomerPicker'
import { checkOverrideReason, creditDecision } from '../../domain/customers/credit'
import { legacyToEffective } from '../../domain/team/roles'
import { recordCreditSale, type Customer } from '../../lib/store/customers'
import Receipt, { type ReceiptFormat } from './Receipt'
import { breakdownRows, type Breakdown } from '../../domain/pos/cashMovements'

export const MANUAL_PAYMENT_NOTICE = 'Wave / Orange Money : enregistrement manuel, aucun paiement réel n’est exécuté.'

type PrintJob = { snapshot: ReceiptSnapshot; format: ReceiptFormat; voided: boolean }

/** Ventes et caisse : session, panier, encaissement par public.record_sale, confirmation, historique des ventes. */
export default function PosPage({ ctx }: { ctx: BoutiqueContext }) {
  const data = useAsync(async () => {
    const installed = await isPosInstalled(ctx.client)
    if (!installed) return { installed: false as const }
    const [session, units, settings] = await Promise.all([
      getOpenSession(ctx.client, ctx.siteId),
      listUnits(ctx.client, ctx.siteId),
      getPosSettings(ctx.client, ctx.siteId),
    ])
    return { installed: true as const, session, units, settings }
  }, [ctx.client, ctx.siteId])
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)
  const [lastSale, setLastSale] = useState<SaleResult | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

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

  const { session, units, settings } = data.data
  const print = (snapshot: ReceiptSnapshot, format: ReceiptFormat, voided = false) => setPrintJob({ snapshot, format, voided })
  const refreshHistory = () => setHistoryKey((n) => n + 1)

  return (
    <div className="bq-stack">
      {heading}
      {manualNotice}
      {!ctx.can.sell && <p className="notice" role="status">Consultation seule : seuls le propriétaire, un administrateur ou un vendeur encaissent.</p>}
      {ctx.can.sell && !session && <OpenSessionForm ctx={ctx} onOpened={data.reload} />}
      {session && <SessionBar ctx={ctx} session={session} onClosed={data.reload} />}
      {session && ctx.can.cashMovements && <CashMovementsPanel ctx={ctx} session={session} cashierCap={settings.cashierMaxExpense} />}
      {lastSale && <SaleConfirmation sale={lastSale} onPrint={print} onNewSale={() => setLastSale(null)} />}
      {ctx.can.sell && session && !lastSale && (
        <SaleForm
          ctx={ctx} session={session} units={units} editorLimit={settings.editorMaxDiscountPercent}
          onSold={(result) => { setLastSale(result); refreshHistory() }}
        />
      )}
      <SalesHistory ctx={ctx} refreshKey={historyKey} onChanged={refreshHistory} onPrint={print} />
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
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
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
      const result = await action()
      setSummary(result)
      setBreakdown(await sessionBreakdown(ctx.client, result.session_id ?? session.id))
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
      {summary && <SummaryView summary={summary} breakdown={breakdown} onDone={summary.status !== 'open' ? onClosed : undefined} />}
    </section>
  )
}

function SummaryView({ summary, breakdown, onDone }: { summary: SessionSummary; breakdown: Breakdown | null; onDone?: () => void }) {
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
          {breakdown && breakdownRows(breakdown).map((row) => (
            <tr key={row.type} className="bq-sub-row">
              <th scope="row">— {row.label} ({row.count})</th>
              <td className="num">{row.direction === -1 ? '−' : row.direction === 1 ? '+' : ''}{money(row.amount)}</td>
            </tr>
          ))}
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

// ── Confirmation de vente ────────────────────────────────────────────────────

/** Écran affiché après une vente réussie ; l'impression lit l'instantané renvoyé par record_sale. */
function SaleConfirmation({ sale, onPrint, onNewSale }: {
  sale: SaleResult
  onPrint: (snapshot: ReceiptSnapshot, format: ReceiptFormat) => void
  onNewSale: () => void
}) {
  const currency = sale.snapshot?.totals?.currency
  return (
    <section className="bq-card bq-stack bq-confirm" aria-label="Vente enregistrée">
      <h2 className="bq-subtitle" role="status"><CheckCircle2 size={20} /> Vente enregistrée</h2>
      <p className="bq-confirm-number">{sale.document_number}</p>
      <dl className="bq-sale-totals">
        <div><dt>Total</dt><dd>{formatMoney(Number(sale.grand_total), currency)}</dd></div>
        <div><dt>Monnaie à rendre</dt><dd>{formatMoney(Number(sale.change_given), currency)}</dd></div>
      </dl>
      <div className="modal-actions">
        <button className="secondary-button" disabled={!sale.snapshot} onClick={() => onPrint(sale.snapshot, 'ticket')}><Printer size={15} /> Imprimer le ticket (80 mm)</button>
        <button className="secondary-button" disabled={!sale.snapshot} onClick={() => onPrint(sale.snapshot, 'a4')}><Printer size={15} /> Imprimer le reçu (A4)</button>
        <button className="primary-button" onClick={onNewSale}>Nouvelle vente</button>
      </div>
    </section>
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

function SaleForm({ ctx, session, units, editorLimit, onSold }: {
  ctx: BoutiqueContext
  session: CashSession
  units: Unit[]
  editorLimit: unknown
  onSold: (result: SaleResult) => void
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 250)
  const results = useAsync(() => searchSaleProducts(ctx.client, ctx.siteId, debounced), [ctx.client, ctx.siteId, debounced])
  const [cart, setCart] = useState<CartLine[]>([])
  const [payments, setPayments] = useState<PaymentDraft[]>([{ key: nextKey++, method: 'cash', amount: '', reference: '' }])
  const [discount, setDiscount] = useState<{ type: 'amount' | 'percent'; value: string; reason: string }>({ type: 'amount', value: '', reason: '' })
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [creditCustomer, setCreditCustomer] = useState<{ customer: Customer; balance: number | null } | null>(null)
  const [override, setOverride] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
  const hasCredit = paymentInputs.some((p) => p.method === 'credit')
  const creditAmount = paymentInputs.filter((p) => p.method === 'credit').reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0)
  const role = ctx.staffRole ?? legacyToEffective(ctx.access.role)
  const decision = hasCredit && creditCustomer && creditCustomer.balance !== null
    ? creditDecision(creditCustomer.balance, creditAmount, creditCustomer.customer.credit_limit, role) : null
  const creditReady = !hasCredit || (decision !== null && decision.kind !== 'blocked' && (decision.kind !== 'override' || !checkOverrideReason(override)))
  const hasCustomer = hasCredit ? !!creditCustomer : !!customer.name.trim() || !!customer.phone.trim()
  const paymentCheck = totals.ok ? checkPayments(totals.totals.grandTotal, paymentInputs, { hasCustomer }) : null
  const ready = allValid && totals.ok && !discountError && paymentCheck?.ok === true && creditReady

  async function checkout() {
    if (!ready) return
    setError('')
    setBusy(true)
    try {
      const lines = cart.map((line) => ({
        product_id: line.product.id,
        unit_id: line.unitId,
        quantity: parseQuantity(line.quantity),
        ...(line.discount.trim() ? { discount: parseMoney(line.discount) ?? 0 } : {}),
      }))
      const saleDiscount = orderDiscount ?? (totals.ok && totals.totals.lineDiscounts > 0 ? { reason: discount.reason.trim() } : null)
      // Crédit : la base contrôle la fiche client et le plafond, puis enregistre la vente (record_credit_sale).
      const result = hasCredit && creditCustomer
        ? await recordCreditSale(ctx.client, {
          siteId: ctx.siteId, sessionId: session.id, customerId: creditCustomer.customer.id,
          lines, payments: paymentInputs, discount: saleDiscount, overrideReason: decision?.kind === 'override' ? override : '',
        })
        : await recordSale(ctx.client, { siteId: ctx.siteId, sessionId: session.id, lines, payments: paymentInputs, customer, discount: saleDiscount })
      // Le formulaire est démonté au profit de l'écran de confirmation : « Nouvelle vente » repart d'un panier vide.
      onSold(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Encaissement impossible.')
      setBusy(false)
    }
  }

  const updateLine = (key: number, patch: Partial<CartLine>) => setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const updatePayment = (key: number, patch: Partial<PaymentDraft>) => setPayments((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  return (
    <section className="bq-card bq-stack" aria-label="Nouvelle vente">
      <h2 className="bq-subtitle">Nouvelle vente</h2>
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

      {hasCredit && (
        <CreditCustomerPicker
          ctx={ctx} customer={creditCustomer?.customer ?? null} balance={creditCustomer?.balance ?? null} decision={decision} override={override}
          onSelect={(c, balance) => { setCreditCustomer(c ? { customer: c, balance } : null); setOverride('') }} onOverride={setOverride}
        />
      )}
      {!hasCredit && <div className="bq-row" aria-label="Client">
        <label className="bq-inline-field bq-grow">Client (facultatif)
          <input maxLength={120} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
        </label>
        <label className="bq-inline-field">Téléphone
          <input maxLength={40} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
        </label>
      </div>}

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

// ── Historique des ventes ────────────────────────────────────────────────────

/** Ventes de la période (jours à Dakar), recherche par numéro, réimpression depuis content_snapshot. */
function SalesHistory({ ctx, refreshKey, onChanged, onPrint }: {
  ctx: BoutiqueContext
  refreshKey: number
  onChanged: () => void
  onPrint: (snapshot: ReceiptSnapshot, format: ReceiptFormat, voided?: boolean) => void
}) {
  const today = shopToday()
  const [fromDay, setFromDay] = useState(today)
  const [toDay, setToDay] = useState(today)
  const [search, setSearch] = useState('')
  const number = normalizeNumberSearch(useDebounced(search, 300))
  const range = dayRange(fromDay, toDay)
  const rangeKey = range.ok ? `${range.from}|${range.to}` : ''
  const sales = useAsync(
    () => (range.ok ? listSales(ctx.client, ctx.siteId, { from: range.from, to: range.to, number }) : Promise.resolve([] as SaleDocument[])),
    [ctx.client, ctx.siteId, rangeKey, number, refreshKey],
  )
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
    <section className="bq-card bq-stack" aria-label="Historique des ventes">
      <h2 className="bq-subtitle">Historique des ventes</h2>
      <div className="bq-row" aria-label="Filtres de l’historique">
        <label className="bq-inline-field">Du
          <input type="date" value={fromDay} max={today} onChange={(e) => setFromDay(e.target.value)} />
        </label>
        <label className="bq-inline-field">Au
          <input type="date" value={toDay} max={today} onChange={(e) => setToDay(e.target.value)} />
        </label>
        <label className="bq-inline-field bq-grow">Numéro
          <input aria-label="Rechercher un numéro de ticket" value={search} maxLength={30} placeholder="TICKET-2026-000042 ou 42" onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      {!range.ok && <p className="bq-error" role="alert">{range.message}</p>}
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {sales.status === 'loading' && <Loading />}
      {sales.status === 'error' && <ErrorPanel message={sales.message} onRetry={sales.reload} />}
      {sales.status === 'ready' && range.ok && (sales.data.length === 0 ? <Empty title="Aucune vente sur cette période." /> : (
        <div className="bq-table-wrap">
          {sales.data.length >= SALES_HISTORY_LIMIT && <p className="bq-hint">Seules les {SALES_HISTORY_LIMIT} ventes les plus récentes sont affichées : réduisez la période.</p>}
          <table className="bq-table" aria-label="Ventes">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Numéro</th><th scope="col" className="num">Total</th><th scope="col">Paiement</th><th scope="col">Vendeur</th><th scope="col">Statut</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {sales.data.map((sale) => {
                const voided = sale.status === 'void'
                return (
                  <tr key={sale.id}>
                    <td>{formatShopDateTime(sale.issued_at)}</td>
                    <td>{sale.document_number}</td>
                    <td className="num">{formatMoney(sale.total_amount, sale.snapshot?.totals.currency)}</td>
                    <td>{paymentModes(sale.snapshot)}</td>
                    <td>{sellerName(sale.snapshot)}</td>
                    <td>{voided ? <span className="bq-badge bq-badge-void" title={sale.void_reason ?? ''}>ANNULÉ</span> : <span className="bq-badge">Émis</span>}</td>
                    <td>
                      {sale.snapshot ? (
                        <>
                          <button className="text-button" aria-label={`Réimprimer le ticket ${sale.document_number}`} onClick={() => onPrint(sale.snapshot!, 'ticket', voided)}>Réimprimer</button>
                          <button className="text-button" aria-label={`Réimprimer le reçu A4 ${sale.document_number}`} onClick={() => onPrint(sale.snapshot!, 'a4', voided)}>A4</button>
                        </>
                      ) : <small className="bq-muted">Instantané illisible</small>}
                      {ctx.can.voidSales && !voided && voiding !== sale.id && (
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
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
