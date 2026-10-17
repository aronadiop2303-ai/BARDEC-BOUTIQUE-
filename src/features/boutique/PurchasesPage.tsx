import { useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { formatShopDateTime } from '../../domain/pos/history'
import { buildPurchaseLines, buildReceiptLines, PO_STATUS_LABELS, SUPPLIER_PAYMENT_LABELS, type PurchaseLineDraft } from '../../domain/purchases/purchases'
import { getOpenSession } from '../../lib/store/pos'
import { searchProducts } from '../../lib/store/products'
import {
  cancelPurchaseOrder, createPurchaseOrder, listPurchaseOrders, listReceivableLines, listReceivableOrders, listSupplierBalances,
  listSuppliers, PurchasesNotInstalledError, receivePurchase, recordSupplierPayment, saveSupplier, type ReceivableOrder, type Supplier,
} from '../../lib/store/purchases'
import { listLocations } from '../../lib/store/stock'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

type Tab = 'orders' | 'receive' | 'suppliers' | 'debts'

/**
 * Fournisseurs et achats. Propriétaire et gérant : tout, prix d'achat compris. Magasinier : réception seulement,
 * sans aucun prix ni montant (fonctions receivable_*).
 */
export default function PurchasesPage({ ctx }: { ctx: BoutiqueContext }) {
  const tabs: { key: Tab; label: string }[] = ctx.can.purchases
    ? [{ key: 'orders', label: 'Bons de commande' }, { key: 'receive', label: 'Réception' }, { key: 'suppliers', label: 'Fournisseurs' }, { key: 'debts', label: 'Dettes fournisseurs' }]
    : [{ key: 'receive', label: 'Réception' }]
  const [tab, setTab] = useState<Tab>(tabs[0].key)
  const [notInstalled, setNotInstalled] = useState(false)
  const onError = (error: unknown) => { if (error instanceof PurchasesNotInstalledError) setNotInstalled(true) }

  return (
    <div className="bq-stack">
      <div className="bq-heading"><div><p className="eyebrow">ACHATS</p><h1 className="bq-title">Fournisseurs et achats</h1></div></div>
      {notInstalled && <p className="bq-error" role="alert">{new PurchasesNotInstalledError().message}</p>}
      {!ctx.can.viewCosts && <p className="notice" role="note">Réception seulement : les prix d’achat sont réservés au propriétaire et au gérant.</p>}
      <div className="bq-row" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'primary-button' : 'secondary-button'} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'orders' && <Orders ctx={ctx} onError={onError} />}
      {tab === 'receive' && <Receive ctx={ctx} onError={onError} />}
      {tab === 'suppliers' && <Suppliers ctx={ctx} onError={onError} />}
      {tab === 'debts' && <Debts ctx={ctx} onError={onError} />}
    </div>
  )
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[], onError: (e: unknown) => void) {
  return useAsync(async () => {
    try { return await load() } catch (error) { onError(error); throw error }
  }, deps)
}

// ── Bons de commande (propriétaire, gérant) ─────────────────────────────────

function Orders({ ctx, onError }: { ctx: BoutiqueContext; onError: (e: unknown) => void }) {
  const [refresh, setRefresh] = useState(0)
  const data = useLoad(async () => {
    const [orders, suppliers] = await Promise.all([listPurchaseOrders(ctx.client, ctx.siteId), listSuppliers(ctx.client, ctx.siteId)])
    return { orders, suppliers }
  }, [ctx.client, ctx.siteId, refresh], onError)
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  if (data.status === 'loading') return <Loading />
  if (data.status === 'error') return <ErrorPanel message={data.message} onRetry={data.reload} />
  const { orders, suppliers } = data.data

  async function cancel(id: string) {
    try {
      await cancelPurchaseOrder(ctx.client, id, reason)
      setMessage({ kind: 'ok', text: 'Bon de commande annulé.' })
      setCancelling(null)
      setRefresh((n) => n + 1)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Annulation impossible.' })
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Bons de commande">
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {creating
        ? <PurchaseOrderForm ctx={ctx} suppliers={suppliers.filter((s) => s.is_active)} onCancel={() => setCreating(false)}
            onCreated={(text) => { setCreating(false); setMessage({ kind: 'ok', text }); setRefresh((n) => n + 1) }} />
        : <div><button className="primary-button" disabled={suppliers.length === 0} onClick={() => setCreating(true)}><Plus size={15} /> Nouveau bon de commande</button>
            {suppliers.length === 0 && <small className="bq-hint"> Créez d’abord un fournisseur.</small>}</div>}
      {orders.length === 0 ? <Empty title="Aucun bon de commande." /> : (
        <div className="bq-table-wrap">
          <table className="bq-table" aria-label="Liste des bons de commande">
            <thead><tr><th scope="col">Numéro</th><th scope="col">Date</th><th scope="col">Fournisseur</th><th scope="col">Statut</th><th scope="col" className="num">Total</th><th scope="col">Lignes</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>{po.number}</td>
                  <td>{formatShopDateTime(po.created_at)}</td>
                  <td>{po.supplier?.name ?? '—'}</td>
                  <td><span className="bq-badge">{PO_STATUS_LABELS[po.status] ?? po.status}</span></td>
                  <td className="num">{formatMoney(po.total_amount)}</td>
                  <td>{po.lines.map((l) => <small key={l.id} className="bq-block">{l.product_name} : {l.received_quantity}/{l.quantity} {l.unit_label ?? ''} à {formatMoney(l.unit_cost)}</small>)}</td>
                  <td>
                    {po.status === 'ordered' && cancelling !== po.id && <button className="text-button" onClick={() => { setCancelling(po.id); setReason('') }}>Annuler</button>}
                    {cancelling === po.id && (
                      <div className="bq-row">
                        <input aria-label={`Motif d’annulation de ${po.number}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Motif" />
                        <button className="primary-button" disabled={reason.trim().length < 3} onClick={() => cancel(po.id)}>Confirmer</button>
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

let nextKey = 1

function PurchaseOrderForm({ ctx, suppliers, onCreated, onCancel }: { ctx: BoutiqueContext; suppliers: Supplier[]; onCreated: (text: string) => void; onCancel: () => void }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [lines, setLines] = useState<(PurchaseLineDraft & { key: number })[]>([])
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const results = useAsync(() => searchProducts(ctx.client, ctx.siteId, term), [ctx.client, ctx.siteId, term])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const built = buildPurchaseLines(lines)

  async function submit() {
    if (!built.ok || !supplierId) return
    setBusy(true)
    setError('')
    try {
      const result = await createPurchaseOrder(ctx.client, ctx.siteId, supplierId, built.lines, note)
      onCreated(`Bon ${result.number} créé : ${formatMoney(Number(result.total_amount))}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Création impossible.')
      setBusy(false)
    }
  }

  const update = (key: number, patch: Partial<PurchaseLineDraft>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="bq-stack" role="group" aria-label="Nouveau bon de commande">
      <label className="bq-inline-field">Fournisseur
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="search-box bq-search"><Search size={16} />
        <input aria-label="Ajouter un produit au bon" value={search} placeholder="Produit à commander…" onChange={(e) => setSearch(e.target.value)} />
      </label>
      {term && results.status === 'ready' && results.data.length > 0 && (
        <ul className="bq-tree" aria-label="Produits trouvés">
          {results.data.map((p) => (
            <li key={p.id} className="bq-row"><span className="bq-grow">{p.name}</span>
              <button className="secondary-button" onClick={() => { setLines((l) => [...l, { key: nextKey++, productId: p.id, productName: p.name, quantity: '', unitCost: '', decimals: 3 }]); setSearch('') }}>Ajouter</button>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && (
        <table className="bq-table" aria-label="Lignes du bon">
          <thead><tr><th scope="col">Produit</th><th scope="col">Quantité (unité de base)</th><th scope="col">Coût d’achat unitaire (FCFA)</th><th scope="col"><span className="sr-only">Retirer</span></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.productName}</td>
                <td><input className="bq-qty" aria-label={`Quantité commandée de ${l.productName}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /></td>
                <td><input className="bq-qty" aria-label={`Coût d’achat de ${l.productName}`} inputMode="numeric" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} /></td>
                <td><button className="text-button" aria-label={`Retirer ${l.productName}`} onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className="bq-inline-field">Note<input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {built.ok && <p className="bq-hint">Total indicatif : {formatMoney(built.indicativeTotal)} (total enregistré : calcul de la base).</p>}
      {!built.ok && lines.length > 0 && <p className="bq-error" role="alert">{built.message}</p>}
      {error && <p className="bq-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Annuler</button>
        <button className="primary-button" disabled={busy || !built.ok || !supplierId} onClick={submit}>Créer le bon de commande</button>
      </div>
    </div>
  )
}

// ── Réception (propriétaire, gérant, magasinier) : aucun prix affiché ───────

function Receive({ ctx, onError }: { ctx: BoutiqueContext; onError: (e: unknown) => void }) {
  const [refresh, setRefresh] = useState(0)
  const data = useLoad(async () => {
    const [orders, locations] = await Promise.all([listReceivableOrders(ctx.client, ctx.siteId), listLocations(ctx.client, ctx.siteId)])
    return { orders, locations: locations.filter((l) => l.is_active) }
  }, [ctx.client, ctx.siteId, refresh], onError)
  const [selected, setSelected] = useState<ReceivableOrder | null>(null)
  const [message, setMessage] = useState('')

  if (data.status === 'loading') return <Loading />
  if (data.status === 'error') return <ErrorPanel message={data.message} onRetry={data.reload} />

  return (
    <section className="bq-card bq-stack" aria-label="Réception">
      {message && <p className="notice" role="status">{message}</p>}
      {data.data.orders.length === 0 ? <Empty title="Aucun bon en attente de réception." /> : (
        <ul className="bq-tree" aria-label="Bons à réceptionner">
          {data.data.orders.map((o) => (
            <li key={o.purchase_order_id} className="bq-row">
              <span className="bq-grow">{o.number} · {o.supplier_name} · {PO_STATUS_LABELS[o.status] ?? o.status}</span>
              <button className="secondary-button" onClick={() => { setSelected(o); setMessage('') }}>Réceptionner</button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <ReceiveForm key={selected.purchase_order_id} ctx={ctx} order={selected} locations={data.data.locations}
          onDone={(text) => { setSelected(null); setMessage(text); setRefresh((n) => n + 1) }} onCancel={() => setSelected(null)} />
      )}
    </section>
  )
}

function ReceiveForm({ ctx, order, locations, onDone, onCancel }: {
  ctx: BoutiqueContext; order: ReceivableOrder; locations: { id: string; name: string }[]; onDone: (text: string) => void; onCancel: () => void
}) {
  const lines = useAsync(() => listReceivableLines(ctx.client, order.purchase_order_id), [ctx.client, order.purchase_order_id])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (lines.status === 'loading') return <Loading />
  if (lines.status === 'error') return <ErrorPanel message={lines.message} onRetry={lines.reload} />
  const built = buildReceiptLines(lines.data, quantities, locationId)
  const touched = Object.values(quantities).some((q) => q.trim() !== '')

  async function submit() {
    if (!built.ok) return
    setBusy(true)
    setError('')
    try {
      const result = await receivePurchase(ctx.client, order.purchase_order_id, built.lines, note)
      onDone(`Réception enregistrée sur ${order.number} : ${result.lines_received} ligne(s), stock mis à jour (${PO_STATUS_LABELS[result.status] ?? result.status}).`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Réception impossible.')
      setBusy(false)
    }
  }

  return (
    <div className="bq-stack" role="group" aria-label={`Réception de ${order.number}`}>
      <strong>Réception de {order.number} ({order.supplier_name})</strong>
      <table className="bq-table" aria-label="Lignes à recevoir">
        <thead><tr><th scope="col">Produit</th><th scope="col" className="num">Commandé</th><th scope="col" className="num">Déjà reçu</th><th scope="col">Reçu maintenant</th></tr></thead>
        <tbody>
          {lines.data.map((l) => (
            <tr key={l.line_id}>
              <td>{l.product_name}{l.unit_label ? <small className="bq-muted"> · {l.unit_label}</small> : null}</td>
              <td className="num">{l.quantity_ordered}</td>
              <td className="num">{l.quantity_received}</td>
              <td><input className="bq-qty" inputMode="decimal" aria-label={`Quantité reçue de ${l.product_name}`} disabled={l.quantity_remaining <= 0}
                value={quantities[l.line_id] ?? ''} onChange={(e) => setQuantities({ ...quantities, [l.line_id]: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bq-row">
        <label className="bq-inline-field">Emplacement
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="bq-inline-field bq-grow">Note (bon de livraison…)<input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {touched && !built.ok && <p className="bq-error" role="alert">{built.message}</p>}
      {error && <p className="bq-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Fermer</button>
        <button className="primary-button" disabled={busy || !built.ok} onClick={submit}>Enregistrer la réception</button>
      </div>
    </div>
  )
}

// ── Fournisseurs ─────────────────────────────────────────────────────────────

function Suppliers({ ctx, onError }: { ctx: BoutiqueContext; onError: (e: unknown) => void }) {
  const [refresh, setRefresh] = useState(0)
  const data = useLoad(() => listSuppliers(ctx.client, ctx.siteId), [ctx.client, ctx.siteId, refresh], onError)
  const [draft, setDraft] = useState({ name: '', phone: '', address: '', notes: '' })
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function add() {
    try {
      await saveSupplier(ctx.client, ctx.siteId, { id: null, ...draft, is_active: true })
      setDraft({ name: '', phone: '', address: '', notes: '' })
      setMessage({ kind: 'ok', text: 'Fournisseur enregistré.' })
      setRefresh((n) => n + 1)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Enregistrement impossible.' })
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Fournisseurs">
      <div className="bq-row">
        <label className="bq-inline-field bq-grow">Nom<input maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="bq-inline-field">Téléphone<input maxLength={40} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
        <label className="bq-inline-field bq-grow">Adresse<input maxLength={300} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label>
        <button className="primary-button" disabled={!draft.name.trim()} onClick={add}><Plus size={15} /> Ajouter</button>
      </div>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {data.status === 'loading' && <Loading />}
      {data.status === 'error' && <ErrorPanel message={data.message} onRetry={data.reload} />}
      {data.status === 'ready' && (data.data.length === 0 ? <Empty title="Aucun fournisseur." /> : (
        <table className="bq-table" aria-label="Liste des fournisseurs">
          <thead><tr><th scope="col">Nom</th><th scope="col">Téléphone</th><th scope="col">Adresse</th></tr></thead>
          <tbody>{data.data.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.phone ?? '—'}</td><td>{s.address ?? '—'}</td></tr>)}</tbody>
        </table>
      ))}
    </section>
  )
}

// ── Dettes et règlements ─────────────────────────────────────────────────────

function Debts({ ctx, onError }: { ctx: BoutiqueContext; onError: (e: unknown) => void }) {
  const [refresh, setRefresh] = useState(0)
  const data = useLoad(() => listSupplierBalances(ctx.client, ctx.siteId), [ctx.client, ctx.siteId, refresh], onError)
  const [paying, setPaying] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function pay(supplierId: string) {
    const value = parseMoney(amount)
    if (value === null || value <= 0) { setMessage({ kind: 'error', text: 'Montant invalide.' }); return }
    try {
      const session = method === 'cash' ? await getOpenSession(ctx.client, ctx.siteId) : null
      if (method === 'cash' && !session) throw new Error('Règlement en espèces : ouvrez d’abord la caisse.')
      const result = await recordSupplierPayment(ctx.client, ctx.siteId, { supplierId, amount: value, method, sessionId: session?.id ?? null, reference, note: '' })
      setMessage({ kind: 'ok', text: `Règlement enregistré. Reste dû : ${formatMoney(result.balance)}.` })
      setPaying(null)
      setAmount('')
      setReference('')
      setRefresh((n) => n + 1)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Règlement impossible.' })
    }
  }

  if (data.status === 'loading') return <Loading />
  if (data.status === 'error') return <ErrorPanel message={data.message} onRetry={data.reload} />
  return (
    <section className="bq-card bq-stack" aria-label="Dettes fournisseurs">
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
      {data.data.length === 0 ? <Empty title="Aucun fournisseur." /> : (
        <table className="bq-table" aria-label="Soldes fournisseurs">
          <thead><tr><th scope="col">Fournisseur</th><th scope="col" className="num">Achats reçus</th><th scope="col" className="num">Réglé</th><th scope="col" className="num">Reste dû</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {data.data.map((b) => (
              <tr key={b.supplier_id}>
                <td>{b.name}</td>
                <td className="num">{formatMoney(b.purchases_total)}</td>
                <td className="num">{formatMoney(b.payments_total)}</td>
                <td className="num"><strong>{formatMoney(b.balance)}</strong></td>
                <td>
                  {b.balance > 0 && paying !== b.supplier_id && <button className="text-button" onClick={() => { setPaying(b.supplier_id); setMessage(null) }}>Régler</button>}
                  {paying === b.supplier_id && (
                    <div className="bq-row">
                      <input className="bq-qty" aria-label={`Montant du règlement à ${b.name}`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
                      <select aria-label="Moyen de règlement" value={method} onChange={(e) => setMethod(e.target.value)}>
                        {Object.entries(SUPPLIER_PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input aria-label="Référence du règlement" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Référence" />
                      <button className="primary-button" onClick={() => pay(b.supplier_id)}>Valider</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
