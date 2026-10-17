import { useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney } from '../../domain/hardware/money'
import { formatQuantity } from '../../domain/hardware/units'
import { marginRate, periodLabel, presetRange, toCsv, type Granularity } from '../../domain/reports/reports'
import { searchProducts } from '../../lib/store/products'
import {
  downloadCsv, marginReport, ReportsNotInstalledError, restockList, salesBySeller, salesReport, setStockThreshold, topProducts,
} from '../../lib/store/reports'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

export const MARGIN_NOTICE = 'Marge estimée au coût moyen ACTUEL des produits (le coût au moment de chaque vente n’est pas encore figé).'

/**
 * Rapports (propriétaire, gérant) et liste « à réapprovisionner » (magasinier compris, sans coût).
 * Tous les montants viennent de la base ; l'écran les affiche et les exporte en CSV.
 */
export default function ReportsPage({ ctx }: { ctx: BoutiqueContext }) {
  const [tab, setTab] = useState<'sales' | 'restock'>(ctx.can.reports ? 'sales' : 'restock')
  return (
    <div className="bq-stack">
      <div className="bq-heading"><div><p className="eyebrow">RAPPORTS</p><h1 className="bq-title">Rapports et alertes</h1></div></div>
      <div className="bq-row" role="tablist">
        {ctx.can.reports && <button role="tab" aria-selected={tab === 'sales'} className={tab === 'sales' ? 'primary-button' : 'secondary-button'} onClick={() => setTab('sales')}>Ventes</button>}
        <button role="tab" aria-selected={tab === 'restock'} className={tab === 'restock' ? 'primary-button' : 'secondary-button'} onClick={() => setTab('restock')}>À réapprovisionner</button>
      </div>
      {tab === 'sales' && ctx.can.reports ? <SalesReports ctx={ctx} /> : <Restock ctx={ctx} />}
    </div>
  )
}

function installedError(message: string) {
  return message === new ReportsNotInstalledError().message
}

function SalesReports({ ctx }: { ctx: BoutiqueContext }) {
  const initial = presetRange('month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [granularity, setGranularity] = useState<Granularity>('day')
  const data = useAsync(async () => {
    const [sales, top, sellers, margin] = await Promise.all([
      salesReport(ctx.client, ctx.siteId, from, to, granularity),
      topProducts(ctx.client, ctx.siteId, from, to),
      salesBySeller(ctx.client, ctx.siteId, from, to),
      ctx.can.viewCosts ? marginReport(ctx.client, ctx.siteId, from, to) : Promise.resolve(null),
    ])
    return { sales, top, sellers, margin }
  }, [ctx.client, ctx.siteId, from, to, granularity])

  const preset = (name: Parameters<typeof presetRange>[0]) => { const r = presetRange(name); setFrom(r.from); setTo(r.to) }

  return (
    <div className="bq-stack">
      <section className="bq-card bq-row" aria-label="Période">
        <label className="bq-inline-field">Du<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="bq-inline-field">Au<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="bq-inline-field">Regrouper par
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
            <option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option>
          </select>
        </label>
        <button className="text-button" onClick={() => preset('today')}>Aujourd’hui</button>
        <button className="text-button" onClick={() => preset('last7')}>7 jours</button>
        <button className="text-button" onClick={() => preset('month')}>Mois en cours</button>
        <button className="text-button" onClick={() => preset('previousMonth')}>Mois précédent</button>
      </section>
      {data.status === 'loading' && <Loading />}
      {data.status === 'error' && (installedError(data.message) ? <p className="bq-error" role="alert">{data.message}</p> : <ErrorPanel message={data.message} onRetry={data.reload} />)}
      {data.status === 'ready' && (
        <>
          <section className="bq-card bq-stack" aria-label="Ventes par période">
            <div className="bq-row">
              <h2 className="bq-subtitle bq-grow">Ventes par {granularity === 'day' ? 'jour' : granularity === 'week' ? 'semaine' : 'mois'}</h2>
              <button className="secondary-button" disabled={data.data.sales.length === 0} onClick={() => downloadCsv(`ventes-${from}-${to}.csv`, toCsv(
                data.data.sales.map((r) => ({ ...r, period: periodLabel(r.period, granularity) })),
                [{ key: 'period', label: 'Période' }, { key: 'sales_count', label: 'Ventes', kind: 'number' }, { key: 'gross_total', label: 'Ventes (FCFA)', kind: 'number' },
                 { key: 'returns_total', label: 'Retours (FCFA)', kind: 'number' }, { key: 'net_total', label: 'Net (FCFA)', kind: 'number' }],
              ))}><Download size={15} /> Exporter CSV</button>
            </div>
            {data.data.sales.length === 0 ? <Empty title="Aucune vente sur cette période." /> : (
              <table className="bq-table" aria-label="Tableau des ventes">
                <thead><tr><th scope="col">Période</th><th scope="col" className="num">Ventes</th><th scope="col" className="num">Total</th><th scope="col" className="num">Retours</th><th scope="col" className="num">Net</th></tr></thead>
                <tbody>{data.data.sales.map((r) => (
                  <tr key={r.period}><td>{periodLabel(r.period, granularity)}</td><td className="num">{r.sales_count}</td><td className="num">{formatMoney(r.gross_total)}</td><td className="num">−{formatMoney(r.returns_total)}</td><td className="num"><strong>{formatMoney(r.net_total)}</strong></td></tr>
                ))}</tbody>
              </table>
            )}
          </section>

          {data.data.margin && (
            <section className="bq-card bq-stack" aria-label="Marge">
              <h2 className="bq-subtitle">Marge (propriétaire et gérant)</h2>
              <p className="notice" role="note">{MARGIN_NOTICE}</p>
              <dl className="bq-sale-totals">
                <div><dt>Chiffre d’affaires (produits avec coût)</dt><dd>{formatMoney(data.data.margin.revenue_with_cost)}</dd></div>
                <div><dt>Coût estimé</dt><dd>{formatMoney(data.data.margin.cost)}</dd></div>
                <div><dt>Marge estimée</dt><dd>{formatMoney(data.data.margin.margin)}{marginRate(data.data.margin.margin, data.data.margin.revenue_with_cost) !== null ? ` (${marginRate(data.data.margin.margin, data.data.margin.revenue_with_cost)} %)` : ''}</dd></div>
              </dl>
              {data.data.margin.products_without_cost > 0 && (
                <p className="bq-hint">{data.data.margin.products_without_cost} produit(s) sans prix d’achat, exclus de la marge ({formatMoney(data.data.margin.revenue_without_cost)} de ventes).</p>
              )}
            </section>
          )}

          <section className="bq-card bq-stack" aria-label="Produits les plus vendus">
            <div className="bq-row">
              <h2 className="bq-subtitle bq-grow">Produits les plus vendus</h2>
              <button className="secondary-button" disabled={data.data.top.length === 0} onClick={() => downloadCsv(`top-produits-${from}-${to}.csv`, toCsv(data.data.top,
                [{ key: 'product_name', label: 'Produit' }, { key: 'unit_label', label: 'Unité' }, { key: 'quantity_sold', label: 'Vendu', kind: 'number' },
                 { key: 'quantity_returned', label: 'Retourné', kind: 'number' }, { key: 'revenue', label: 'Chiffre d’affaires net (FCFA)', kind: 'number' }]))}>
                <Download size={15} /> Exporter CSV</button>
            </div>
            {data.data.top.length === 0 ? <Empty title="Aucune vente." /> : (
              <table className="bq-table" aria-label="Top produits">
                <thead><tr><th scope="col">Produit</th><th scope="col" className="num">Vendu</th><th scope="col" className="num">Retourné</th><th scope="col" className="num">CA net</th></tr></thead>
                <tbody>{data.data.top.map((r) => (
                  <tr key={r.product_id ?? r.product_name}><td>{r.product_name}</td><td className="num">{formatQuantity(r.quantity_sold)} {r.unit_label ?? ''}</td><td className="num">{formatQuantity(r.quantity_returned)}</td><td className="num">{formatMoney(r.revenue)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="bq-card bq-stack" aria-label="Ventes par vendeur">
            <div className="bq-row">
              <h2 className="bq-subtitle bq-grow">Ventes par vendeur</h2>
              <button className="secondary-button" disabled={data.data.sellers.length === 0} onClick={() => downloadCsv(`vendeurs-${from}-${to}.csv`, toCsv(data.data.sellers,
                [{ key: 'cashier_name', label: 'Vendeur' }, { key: 'sales_count', label: 'Ventes', kind: 'number' }, { key: 'total', label: 'Total (FCFA)', kind: 'number' }]))}>
                <Download size={15} /> Exporter CSV</button>
            </div>
            {data.data.sellers.length === 0 ? <Empty title="Aucune vente." /> : (
              <table className="bq-table" aria-label="Vendeurs">
                <thead><tr><th scope="col">Vendeur</th><th scope="col" className="num">Ventes</th><th scope="col" className="num">Total</th></tr></thead>
                <tbody>{data.data.sellers.map((r) => <tr key={r.cashier_id ?? 'none'}><td>{r.cashier_name}</td><td className="num">{r.sales_count}</td><td className="num">{formatMoney(r.total)}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Restock({ ctx }: { ctx: BoutiqueContext }) {
  const [refresh, setRefresh] = useState(0)
  const data = useAsync(() => restockList(ctx.client, ctx.siteId), [ctx.client, ctx.siteId, refresh])
  return (
    <div className="bq-stack">
      <ThresholdForm ctx={ctx} onSaved={() => setRefresh((n) => n + 1)} />
      <section className="bq-card bq-stack" aria-label="À réapprovisionner">
        <div className="bq-row">
          <h2 className="bq-subtitle bq-grow">À réapprovisionner</h2>
          {data.status === 'ready' && data.data.length > 0 && (
            <button className="secondary-button" onClick={() => downloadCsv('a-reapprovisionner.csv', toCsv(data.data,
              [{ key: 'product_name', label: 'Produit' }, { key: 'sku', label: 'SKU' }, { key: 'unit_label', label: 'Unité' }, { key: 'stock', label: 'Stock', kind: 'number' },
               { key: 'min_quantity', label: 'Seuil', kind: 'number' }, { key: 'suggested_quantity', label: 'À commander', kind: 'number' }]))}>
              <Download size={15} /> Exporter CSV</button>
          )}
        </div>
        {data.status === 'loading' && <Loading />}
        {data.status === 'error' && (installedError(data.message) ? <p className="bq-error" role="alert">{data.message}</p> : <ErrorPanel message={data.message} onRetry={data.reload} />)}
        {data.status === 'ready' && (data.data.length === 0 ? <Empty title="Aucun produit sous son seuil.">Les seuils se définissent ci-dessus, produit par produit.</Empty> : (
          <table className="bq-table" aria-label="Produits sous le seuil">
            <thead><tr><th scope="col">Produit</th><th scope="col" className="num">Stock</th><th scope="col" className="num">Seuil</th><th scope="col" className="num">À commander</th></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.product_id} className={r.stock <= 0 ? 'bq-row-error' : undefined}>
                <td>{r.product_name}{r.sku ? <small className="bq-muted"> · {r.sku}</small> : null}</td>
                <td className="num">{formatQuantity(r.stock)} {r.unit_label ?? ''}</td>
                <td className="num">{formatQuantity(r.min_quantity)}</td>
                <td className="num"><strong>{formatQuantity(r.suggested_quantity)}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </section>
    </div>
  )
}

function ThresholdForm({ ctx, onSaved }: { ctx: BoutiqueContext; onSaved: () => void }) {
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const results = useAsync(() => searchProducts(ctx.client, ctx.siteId, term), [ctx.client, ctx.siteId, term])
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null)
  const [min, setMin] = useState('')
  const [reorder, setReorder] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const parse = (t: string) => (t.trim() === '' ? null : Number(t.replace(',', '.')))

  async function save() {
    if (!product) return
    const minValue = parse(min)
    const reorderValue = parse(reorder)
    if (minValue !== null && (!Number.isFinite(minValue) || minValue < 0)) { setMessage({ kind: 'error', text: 'Seuil invalide.' }); return }
    if (reorderValue !== null && (!Number.isFinite(reorderValue) || reorderValue <= 0)) { setMessage({ kind: 'error', text: 'Quantité de réapprovisionnement invalide.' }); return }
    try {
      await setStockThreshold(ctx.client, product.id, minValue, reorderValue)
      setMessage({ kind: 'ok', text: minValue === null ? `Seuil retiré pour « ${product.name} ».` : `Seuil de « ${product.name} » : ${formatQuantity(minValue)}.` })
      setProduct(null); setMin(''); setReorder('')
      onSaved()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Enregistrement impossible.' })
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Seuil de stock bas">
      <h2 className="bq-subtitle">Seuil de stock bas</h2>
      {product ? (
        <div className="bq-row">
          <strong className="bq-grow">{product.name}</strong>
          <label className="bq-inline-field">Seuil minimum (unité de base)<input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
          <label className="bq-inline-field">Quantité à recommander<input inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} /></label>
          <button className="primary-button" onClick={save}>Enregistrer</button>
          <button className="text-button" onClick={() => setProduct(null)}>Changer</button>
        </div>
      ) : (
        <>
          <label className="search-box bq-search"><Search size={16} />
            <input aria-label="Produit pour le seuil" value={search} placeholder="Produit…" onChange={(e) => setSearch(e.target.value)} />
          </label>
          {term && results.status === 'ready' && results.data.length > 0 && (
            <ul className="bq-tree">{results.data.map((p) => (
              <li key={p.id} className="bq-row"><span className="bq-grow">{p.name}</span><button className="secondary-button" onClick={() => { setProduct(p); setSearch('') }}>Choisir</button></li>
            ))}</ul>
          )}
        </>
      )}
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
    </section>
  )
}
