import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, Printer, Search } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { AGING_BUCKETS, agingBucket, checkPayment, groupByAging, LEDGER_LABELS, PAYMENT_METHOD_LABELS, validateCustomer } from '../../domain/customers/credit'
import { formatShopDateTime } from '../../domain/pos/history'
import {
  CustomersNotInstalledError, getStatement, listCustomers, listReceivables, recordCustomerPayment, saveCustomer,
  type Customer, type Receivable, type Statement,
} from '../../lib/store/customers'
import { getOpenSession } from '../../lib/store/pos'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

export const NO_REMINDER_NOTICE = 'Aucune relance automatique (ni SMS ni e-mail) : les impayés sont à suivre ici.'

/** Clients et crédit : fiches, soldes et relevés calculés par la base, versements, impayés avec ancienneté. */
export default function CustomersPage({ ctx }: { ctx: BoutiqueContext }) {
  const [tab, setTab] = useState<'clients' | 'impayes'>('clients')
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 300)
  const [refresh, setRefresh] = useState(0)
  const data = useAsync(async () => {
    try {
      const [customers, receivables] = await Promise.all([listCustomers(ctx.client, ctx.siteId, term), listReceivables(ctx.client, ctx.siteId)])
      return { installed: true as const, customers, receivables }
    } catch (error) {
      if (error instanceof CustomersNotInstalledError) return { installed: false as const, customers: [] as Customer[], receivables: [] as Receivable[] }
      throw error
    }
  }, [ctx.client, ctx.siteId, term, refresh])

  const heading = <div className="bq-heading"><div><p className="eyebrow">CLIENTS</p><h1 className="bq-title">Clients et crédit</h1></div></div>
  if (data.status === 'loading') return <div className="bq-stack">{heading}<Loading /></div>
  if (data.status === 'error') return <div className="bq-stack">{heading}<ErrorPanel message={data.message} onRetry={data.reload} /></div>
  if (!data.data.installed) {
    return <div className="bq-stack">{heading}<p className="bq-error" role="alert">{new CustomersNotInstalledError().message}</p></div>
  }

  const { customers, receivables } = data.data
  const balances = new Map(receivables.map((r) => [r.customer_id, r.balance]))
  const changed = () => setRefresh((n) => n + 1)

  if (selected) {
    const customer = selected === 'new' ? null : customers.find((c) => c.id === selected) ?? null
    return (
      <div className="bq-stack">
        {heading}
        <button className="text-button" onClick={() => setSelected(null)}><ArrowLeft size={15} /> Retour aux clients</button>
        <CustomerForm ctx={ctx} customer={customer} onSaved={(id) => { changed(); setSelected(id) }} />
        {customer && <CustomerAccount ctx={ctx} customer={customer} onChanged={changed} />}
      </div>
    )
  }

  return (
    <div className="bq-stack">
      {heading}
      <p className="notice" role="note">{NO_REMINDER_NOTICE}</p>
      <div className="bq-row" role="tablist">
        <button role="tab" aria-selected={tab === 'clients'} className={tab === 'clients' ? 'primary-button' : 'secondary-button'} onClick={() => setTab('clients')}>Clients</button>
        <button role="tab" aria-selected={tab === 'impayes'} className={tab === 'impayes' ? 'primary-button' : 'secondary-button'} onClick={() => setTab('impayes')}>Impayés ({receivables.length})</button>
      </div>
      {tab === 'clients' ? (
        <section className="bq-card bq-stack" aria-label="Clients">
          <div className="bq-row">
            <label className="search-box bq-search bq-grow">
              <Search size={17} />
              <input aria-label="Rechercher un client" value={search} placeholder="Nom ou téléphone…" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button className="primary-button" onClick={() => setSelected('new')}><Plus size={15} /> Nouveau client</button>
          </div>
          {customers.length === 0 ? <Empty title={term ? 'Aucun client ne correspond.' : 'Aucun client enregistré.'} /> : (
            <div className="bq-table-wrap">
              <table className="bq-table" aria-label="Liste des clients">
                <thead><tr><th scope="col">Nom</th><th scope="col">Téléphone</th><th scope="col" className="num">Plafond</th><th scope="col" className="num">Solde dû</th><th scope="col">Statut</th></tr></thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td><button className="text-button" onClick={() => setSelected(c.id)}>{c.name}</button></td>
                      <td>{c.phone ?? '—'}</td>
                      <td className="num">{formatMoney(c.credit_limit)}</td>
                      <td className="num">{formatMoney(balances.get(c.id) ?? 0)}</td>
                      <td>{c.is_active ? <span className="bq-badge">Actif</span> : <span className="bq-badge bq-badge-void">Désactivé</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : <ReceivablesView receivables={receivables} onOpen={setSelected} />}
    </div>
  )
}

function ReceivablesView({ receivables, onOpen }: { receivables: Receivable[]; onOpen: (id: string) => void }) {
  const groups = groupByAging(receivables)
  return (
    <section className="bq-card bq-stack" aria-label="Impayés">
      <dl className="bq-sale-totals">
        {AGING_BUCKETS.map((b) => (
          <div key={b.key}><dt>{b.label} ({groups[b.key].count})</dt><dd>{formatMoney(groups[b.key].total)}</dd></div>
        ))}
      </dl>
      {receivables.length === 0 ? <Empty title="Aucun impayé." /> : (
        <div className="bq-table-wrap">
          <table className="bq-table" aria-label="Liste des impayés">
            <thead><tr><th scope="col">Client</th><th scope="col">Téléphone</th><th scope="col" className="num">Solde dû</th><th scope="col" className="num">Plafond</th><th scope="col">Plus ancienne vente non soldée</th><th scope="col" className="num">Jours</th></tr></thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.customer_id} className={agingBucket(r.days_outstanding) === '90+' ? 'bq-row-error' : undefined}>
                  <td><button className="text-button" onClick={() => onOpen(r.customer_id)}>{r.name}</button></td>
                  <td>{r.phone ?? '—'}</td>
                  <td className="num">{formatMoney(r.balance)}</td>
                  <td className="num">{formatMoney(r.credit_limit)}{r.balance > r.credit_limit && <small className="bq-error"> dépassé</small>}</td>
                  <td>{r.oldest_unpaid_at ? formatShopDateTime(r.oldest_unpaid_at) : '—'}</td>
                  <td className="num">{r.days_outstanding}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CustomerForm({ ctx, customer, onSaved }: { ctx: BoutiqueContext; customer: Customer | null; onSaved: (id: string) => void }) {
  const canSetLimit = ctx.can.manageCredit
  const [draft, setDraft] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '',
    creditLimit: customer ? String(customer.credit_limit) : '0',
  })
  const [active, setActive] = useState(customer?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const problem = validateCustomer(draft, canSetLimit)

  async function save() {
    if (problem) { setMessage({ kind: 'error', text: problem }); return }
    setBusy(true)
    setMessage(null)
    try {
      const limit = canSetLimit && draft.creditLimit.trim() !== '' ? Number(draft.creditLimit.replace(/\s/g, '')) : null
      const id = await saveCustomer(ctx.client, ctx.siteId, { id: customer?.id ?? null, name: draft.name, phone: draft.phone, address: draft.address, creditLimit: limit, isActive: active })
      setMessage({ kind: 'ok', text: 'Fiche client enregistrée.' })
      onSaved(id)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Enregistrement impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Fiche client">
      <h2 className="bq-subtitle">{customer ? customer.name : 'Nouveau client'}</h2>
      <div className="bq-row">
        <label className="bq-inline-field bq-grow">Nom *<input maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="bq-inline-field">Téléphone<input maxLength={40} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
      </div>
      <label className="bq-inline-field">Adresse<input maxLength={300} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label>
      <div className="bq-row">
        <label className="bq-inline-field">Plafond de crédit (FCFA)
          <input inputMode="numeric" disabled={!canSetLimit} value={draft.creditLimit} onChange={(e) => setDraft({ ...draft, creditLimit: e.target.value })} />
        </label>
        {!canSetLimit && <small className="bq-hint">Seuls le propriétaire et le gérant fixent le plafond.</small>}
        {customer && canSetLimit && (
          <label className="bq-row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Client actif</label>
        )}
      </div>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      <div className="modal-actions"><button className="primary-button" disabled={busy} onClick={save}>Enregistrer la fiche</button></div>
    </section>
  )
}

function CustomerAccount({ ctx, customer, onChanged }: { ctx: BoutiqueContext; customer: Customer; onChanged: () => void }) {
  const [refresh, setRefresh] = useState(0)
  const statement = useAsync(() => getStatement(ctx.client, ctx.siteId, customer.id), [ctx.client, ctx.siteId, customer.id, refresh])
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!printing) return
    const timer = setTimeout(() => { window.print(); setPrinting(false) }, 0)
    return () => clearTimeout(timer)
  }, [printing])

  if (statement.status === 'loading') return <Loading />
  if (statement.status === 'error') return <ErrorPanel message={statement.message} onRetry={statement.reload} />
  const s = statement.data

  return (
    <>
      <PaymentForm ctx={ctx} customer={customer} balance={s.balance} onPaid={() => { setRefresh((n) => n + 1); onChanged() }} />
      <section className="bq-card bq-stack" aria-label="Relevé du client">
        <div className="bq-row">
          <h2 className="bq-subtitle bq-grow">Relevé — solde dû : {formatMoney(s.balance)}</h2>
          <button className="secondary-button" onClick={() => setPrinting(true)}><Printer size={15} /> Imprimer le relevé</button>
        </div>
        <StatementTable statement={s} />
      </section>
      {printing && (
        <div className="print-root" aria-hidden="true">
          <article className="receipt receipt-a4" aria-label={`Relevé ${s.customer.name}`}>
            <style>{'@page { size: A4; margin: 15mm; }'}</style>
            <header className="receipt-head">
              <strong className="receipt-shop">{ctx.access.site.name}</strong>
              <span>Relevé de compte client</span>
            </header>
            <dl className="receipt-meta">
              <div><dt>Client</dt><dd>{s.customer.name}</dd></div>
              {s.customer.phone && <div><dt>Téléphone</dt><dd>{s.customer.phone}</dd></div>}
              <div><dt>Édité le</dt><dd>{formatShopDateTime(s.generated_at)}</dd></div>
              <div><dt>Plafond de crédit</dt><dd>{formatMoney(s.customer.credit_limit)}</dd></div>
            </dl>
            <StatementTable statement={s} />
            <dl className="receipt-totals"><div className="receipt-grand"><dt>SOLDE DÛ</dt><dd>{formatMoney(s.balance)}</dd></div></dl>
          </article>
        </div>
      )}
    </>
  )
}

function StatementTable({ statement }: { statement: Statement }) {
  if (statement.entries.length === 0) return <Empty title="Aucune opération." />
  return (
    <div className="bq-table-wrap">
      <table className="bq-table receipt-lines" aria-label="Opérations">
        <thead><tr><th scope="col">Date</th><th scope="col">Opération</th><th scope="col">Référence</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th><th scope="col" className="num">Solde</th></tr></thead>
        <tbody>
          {statement.entries.map((e, i) => (
            <tr key={i}>
              <td>{formatShopDateTime(e.date)}</td>
              <td>
                {LEDGER_LABELS[e.type] ?? e.type}{e.method ? ` · ${PAYMENT_METHOD_LABELS[e.method] ?? e.method}` : ''}
                {e.override_reason && <small> Plafond dépassé, autorisé : {e.override_reason}</small>}
              </td>
              <td>{e.document_number ?? e.reference ?? '—'}</td>
              <td className="num">{e.debit > 0 ? formatMoney(e.debit) : ''}</td>
              <td className="num">{e.credit > 0 ? formatMoney(e.credit) : ''}</td>
              <td className="num">{formatMoney(e.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentForm({ ctx, customer, balance, onPaid }: { ctx: BoutiqueContext; customer: Customer; balance: number; onPaid: () => void }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'wave' | 'orange_money' | 'card'>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const value = parseMoney(amount)
  const problem = useMemo(() => (amount.trim() === '' ? null : value === null ? 'Montant invalide.' : checkPayment(value, balance)), [amount, value, balance])

  if (!ctx.can.sell) return null
  if (balance <= 0) return <p className="notice" role="status">{customer.name} n’a aucun solde dû.</p>

  async function pay() {
    if (value === null || problem) return
    setBusy(true)
    setMessage(null)
    try {
      const session = method === 'cash' ? await getOpenSession(ctx.client, ctx.siteId) : null
      if (method === 'cash' && !session) throw new Error('Versement en espèces : ouvrez d’abord la caisse.')
      const result = await recordCustomerPayment(ctx.client, ctx.siteId, { customerId: customer.id, amount: value, method, sessionId: session?.id ?? null, reference, note })
      setMessage({ kind: 'ok', text: `Versement de ${formatMoney(value)} enregistré. Nouveau solde : ${formatMoney(result.balance)}.` })
      setAmount('')
      setReference('')
      setNote('')
      onPaid()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Versement impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Versement">
      <h2 className="bq-subtitle">Enregistrer un versement</h2>
      <div className="bq-row">
        <label className="bq-inline-field">Montant (FCFA)<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="bq-inline-field">Moyen
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="bq-inline-field">Référence<input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        <label className="bq-inline-field bq-grow">Note<input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="primary-button" disabled={busy || value === null || !!problem} onClick={pay}>Enregistrer le versement</button>
      </div>
      {method === 'cash' && <small className="bq-hint">Espèces : inscrites comme apport dans la caisse ouverte (comptées dans l’attendu X/Z).</small>}
      {method !== 'cash' && <small className="bq-hint">Enregistrement manuel : aucun paiement réel n’est exécuté.</small>}
      {problem && <p className="bq-error" role="alert">{problem}</p>}
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
    </section>
  )
}
