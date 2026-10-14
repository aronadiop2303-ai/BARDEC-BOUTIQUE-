import { useState } from 'react'
import { Search } from 'lucide-react'
import { Empty, ErrorPanel, Loading, Pagination } from '../../components/StatePanel'
import { STOCK_STATUS_LABELS, stockStatus, totalForProduct } from '../../domain/hardware/stock'
import { formatQuantity } from '../../domain/hardware/units'
import { boutiquePath } from '../../lib/router'
import { listProducts } from '../../lib/store/products'
import { listLocations, loadStockLevels } from '../../lib/store/stock'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

const PAGE_SIZE = 20

/**
 * Consultation du stock (lecture seule), calculée à partir du registre inventory_movements.
 * La saisie est impossible aujourd'hui : aucune politique d'écriture sur le registre (jalon Q2).
 */
export default function StockPage({ ctx }: { ctx: BoutiqueContext }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const debounced = useDebounced(search, 300)

  const data = useAsync(async () => {
    const [locations, products] = await Promise.all([
      listLocations(ctx.client, ctx.siteId),
      listProducts(ctx.client, ctx.siteId, { search: debounced, status: 'current', page, pageSize: PAGE_SIZE }),
    ])
    const stock = await loadStockLevels(ctx.client, ctx.siteId, products.rows.map((p) => p.id))
    return { locations, products, stock }
  }, [ctx.client, ctx.siteId, debounced, page])

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div><p className="eyebrow">STOCK</p><h1 className="bq-title">Niveaux de stock</h1></div>
      </div>
      <p className="notice" role="status">Consultation seule. <strong>Saisie du stock (entrées, inventaire, pertes) : jalon Q2</strong> — la base n’autorise encore aucune écriture dans le registre. Quantités exprimées dans l’unité de base de chaque produit.</p>

      <label className="search-box bq-search">
        <Search size={17} />
        <input aria-label="Rechercher un produit" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Nom, référence ou code-barres…" />
      </label>

      {data.status === 'loading' && <Loading label="Calcul des niveaux de stock…" />}
      {data.status === 'error' && <ErrorPanel message={data.message} onRetry={data.reload} />}
      {data.status === 'ready' && data.data.products.rows.length === 0 && <Empty title={debounced ? 'Aucun produit ne correspond.' : 'Aucun produit dans le catalogue.'} />}
      {data.status === 'ready' && data.data.products.rows.length > 0 && (() => {
        const { locations, products, stock } = data.data
        const shown = locations.filter((l) => l.is_active)
        const quantityAt = (productId: string, locationId: string | null) =>
          stock.levels.find((level) => level.productId === productId && level.locationId === locationId)?.quantity ?? 0
        const unplaced = stock.levels.some((level) => level.locationId === null)
        return (
          <>
            {stock.truncated && <p className="bq-error" role="alert">Calcul partiel : trop de mouvements à lire en une fois. Une vue SQL de niveau de stock est prévue en Q2.</p>}
            <div className="bq-table-wrap">
              <table className="bq-table">
                <thead>
                  <tr>
                    <th scope="col">Produit</th>
                    {shown.map((l) => <th scope="col" className="num" key={l.id}>{l.name}</th>)}
                    {unplaced && <th scope="col" className="num">Sans emplacement</th>}
                    <th scope="col" className="num">Total</th>
                    <th scope="col">État</th>
                  </tr>
                </thead>
                <tbody>
                  {products.rows.map((product) => {
                    const total = totalForProduct(stock.levels, product.id)
                    const status = stockStatus(total, { tracked: product.track_inventory })
                    return (
                      <tr key={product.id}>
                        <td><a href={boutiquePath(ctx.siteId, 'produits', product.id)}>{product.name}</a></td>
                        {shown.map((l) => <td className="num" key={l.id}>{formatQuantity(quantityAt(product.id, l.id))}</td>)}
                        {unplaced && <td className="num">{formatQuantity(quantityAt(product.id, null))}</td>}
                        <td className="num"><strong>{formatQuantity(total)}</strong></td>
                        <td><span className={`bq-badge bq-stock-${status}`}>{STOCK_STATUS_LABELS[status]}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="bq-hint">Seuils minimum et alertes de rupture : jalon Q2 (aucune colonne de seuil en base).</p>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.total} onPage={setPage} />
          </>
        )
      })()}
    </div>
  )
}
