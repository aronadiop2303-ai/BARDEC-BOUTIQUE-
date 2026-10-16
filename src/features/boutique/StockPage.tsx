import { useState } from 'react'
import { History, PackagePlus, Search, X } from 'lucide-react'
import { Empty, ErrorPanel, Loading, Pagination } from '../../components/StatePanel'
import { STOCK_STATUS_LABELS, stockStatus, totalForProduct } from '../../domain/hardware/stock'
import { formatQuantity, type Unit } from '../../domain/hardware/units'
import { checkMovement, MANUAL_MOVEMENT_TYPES, MOVEMENT_LABELS, parseQuantityInput, reasonRequired, type ManualMovementType } from '../../domain/stock/movements'
import { boutiquePath } from '../../lib/router'
import { searchSaleProducts, type SaleProduct } from '../../lib/store/pos'
import { listProducts } from '../../lib/store/products'
import {
  listLocations, listProductMovements, loadStockLevels, recordStockMovement, stockEntriesAvailable, type StockLocation,
} from '../../lib/store/stock'
import { listUnits } from '../../lib/store/units'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

const PAGE_SIZE = 20

export const STOCK_UNAVAILABLE = 'Disponible après la mise à jour de la base'

/**
 * Niveaux de stock calculés à partir du registre inventory_movements, et saisie des mouvements manuels
 * (propriétaire et admin) par la fonction SQL public.record_stock_movement.
 */
export default function StockPage({ ctx }: { ctx: BoutiqueContext }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const debounced = useDebounced(search, 300)
  const [form, setForm] = useState<ManualMovementType | null>(null)
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null)
  const [message, setMessage] = useState('')

  const data = useAsync(async () => {
    const [locations, units, products] = await Promise.all([
      listLocations(ctx.client, ctx.siteId),
      listUnits(ctx.client, ctx.siteId),
      listProducts(ctx.client, ctx.siteId, { search: debounced, status: 'current', page, pageSize: PAGE_SIZE }),
    ])
    const stock = await loadStockLevels(ctx.client, ctx.siteId, products.rows.map((p) => p.id))
    return { locations, units, products, stock }
  }, [ctx.client, ctx.siteId, debounced, page])

  const available = useAsync(async () => (ctx.can.writeStock ? stockEntriesAvailable(ctx.client) : false), [ctx.client, ctx.can.writeStock])

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div><p className="eyebrow">STOCK</p><h1 className="bq-title">Niveaux de stock</h1></div>
        {ctx.can.writeStock && (
          <div className="bq-row" aria-label="Mouvements de stock">
            {(['restock', 'initial_stock', 'adjustment'] as ManualMovementType[]).map((type) => (
              <button key={type} className={type === 'restock' ? 'primary-button' : 'secondary-button'}
                disabled={available.status !== 'ready' || !available.data}
                onClick={() => { setForm(type); setMessage('') }}>
                {type === 'restock' && <PackagePlus size={16} />} {MOVEMENT_LABELS[type]}
              </button>
            ))}
          </div>
        )}
      </div>

      {ctx.can.writeStock && available.status === 'ready' && !available.data && (
        <p className="notice" role="status">Saisie du stock (entrées, inventaire initial, ajustements) : {STOCK_UNAVAILABLE}.</p>
      )}
      {ctx.can.writeStock && available.status === 'error' && <p className="bq-error" role="alert">{available.message}</p>}
      {!ctx.can.writeStock && (
        <p className="notice" role="status">Consultation seule : seuls le propriétaire et les administrateurs saisissent des mouvements de stock.</p>
      )}
      <p className="bq-hint">Quantités exprimées dans l’unité de base de chaque produit. Chaque mouvement est enregistré et journalisé par la base.</p>
      {message && <p className="notice" role="status">{message}</p>}

      {form && data.status === 'ready' && available.status === 'ready' && available.data && (
        <MovementForm
          ctx={ctx}
          initialType={form}
          locations={data.data.locations.filter((l) => l.is_active)}
          units={data.data.units}
          onCancel={() => setForm(null)}
          onDone={(text) => { setForm(null); setMessage(text); data.reload() }}
        />
      )}

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
                    <th scope="col"><span className="sr-only">Historique</span></th>
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
                        <td>
                          <button className="text-button" aria-label={`Historique de ${product.name}`} onClick={() => setHistoryFor({ id: product.id, name: product.name })}>
                            <History size={15} /> Historique
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="bq-hint">Seuils minimum et alertes de rupture : pas encore de colonne de seuil en base.</p>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.total} onPage={setPage} />
            {historyFor && (
              <MovementHistory ctx={ctx} product={historyFor} locations={locations} units={data.data.units} onClose={() => setHistoryFor(null)} />
            )}
          </>
        )
      })()}
    </div>
  )
}

// ── Saisie d'un mouvement ────────────────────────────────────────────────────

function MovementForm({ ctx, initialType, locations, units, onCancel, onDone }: {
  ctx: BoutiqueContext
  initialType: ManualMovementType
  locations: StockLocation[]
  units: Unit[]
  onCancel: () => void
  onDone: (message: string) => void
}) {
  const [type, setType] = useState<ManualMovementType>(initialType)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 250)
  const results = useAsync(() => searchSaleProducts(ctx.client, ctx.siteId, debounced), [ctx.client, ctx.siteId, debounced])
  const [product, setProduct] = useState<SaleProduct | null>(null)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [unitId, setUnitId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const levels = useAsync(
    async () => (product ? (await loadStockLevels(ctx.client, ctx.siteId, [product.id])).levels : []),
    [ctx.client, ctx.siteId, product?.id],
  )

  const unitById = new Map(units.map((u) => [u.id, u]))
  const sell = product?.sellUnits.find((u) => u.unit_id === unitId)
  const unit = sell ? unitById.get(sell.unit_id) : undefined
  const baseUnit = product?.sellUnits.find((u) => u.conversion_to_base === 1)
  const baseLabel = baseUnit ? unitById.get(baseUnit.unit_id)?.label ?? '' : ''
  const level = levels.status === 'ready' ? levels.data.find((l) => l.locationId === locationId) : undefined
  const availableQty = level?.quantity ?? 0
  const parsed = parseQuantityInput(quantity)
  // allowNegative : la base connaît le réglage du produit et du site ; ici on avertit sans bloquer.
  const check = product && sell && unit && quantity.trim() !== ''
    ? checkMovement({ type, quantity: parsed, sellUnit: sell, unit, reason, available: availableQty, allowNegative: true, hasMovements: !!level })
    : null

  function choose(next: SaleProduct) {
    setProduct(next)
    const preferred = next.sellUnits.find((u) => u.conversion_to_base === 1) ?? next.sellUnits[0]
    setUnitId(preferred?.unit_id ?? '')
    setQuery('')
    setError('')
  }

  async function submit() {
    if (!product || !sell || !check?.ok || !locationId) return
    setError('')
    setBusy(true)
    try {
      const result = await recordStockMovement(ctx.client, { siteId: ctx.siteId, productId: product.id, locationId, type, quantity: parsed, unitId: sell.unit_id, reason })
      const location = locations.find((l) => l.id === locationId)?.name ?? ''
      onDone(`${MOVEMENT_LABELS[type]} enregistré : ${product.name}, ${location}. Stock : ${formatQuantity(Number(result.stock_before))} → ${formatQuantity(Number(result.stock_after))} ${baseLabel}.`)
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Mouvement de stock">
      <div className="bq-row">
        <h2 className="bq-subtitle bq-grow">{MOVEMENT_LABELS[type]}</h2>
        <button className="text-button" aria-label="Fermer" onClick={onCancel}><X size={16} /></button>
      </div>
      {locations.length === 0 && <p className="bq-error" role="alert">Aucun emplacement actif : ajoutez-en un dans les paramètres de la boutique.</p>}

      <div className="bq-form-grid">
        <label className="bq-field"><span className="field-label">Type de mouvement</span>
          <select value={type} onChange={(e) => setType(e.target.value as ManualMovementType)}>
            {MANUAL_MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="bq-field"><span className="field-label">Emplacement</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <div className="bq-field bq-span-2">
          <span className="field-label">Produit</span>
          {product ? (
            <div className="bq-row">
              <strong className="bq-grow">{product.name}</strong>
              <button className="text-button" onClick={() => setProduct(null)}>Changer</button>
            </div>
          ) : (
            <>
              <input className="name-input" aria-label="Rechercher le produit" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, référence ou code-barres…" />
              {debounced && results.status === 'ready' && results.data.length === 0 && <small className="bq-hint">Aucun produit actif ne correspond.</small>}
              {debounced && results.status === 'ready' && results.data.length > 0 && (
                <ul className="bq-tree" aria-label="Produits trouvés">
                  {results.data.map((p) => (
                    <li key={p.id} className="bq-row">
                      <span className="bq-grow">{p.name}</span>
                      <button className="secondary-button" onClick={() => choose(p)}>Choisir</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {product && (
          <>
            <label className="bq-field"><span className="field-label">Unité</span>
              <select aria-label="Unité du mouvement" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {product.sellUnits.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {unitById.get(u.unit_id)?.label ?? 'Unité'}{u.conversion_to_base !== 1 ? ` (= ${formatQuantity(u.conversion_to_base)} ${baseLabel})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="bq-field"><span className="field-label">Quantité{type === 'adjustment' ? ' (négative pour retirer)' : ''}</span>
              <input className="name-input" aria-label="Quantité du mouvement" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </>
        )}

        <label className="bq-field bq-span-2"><span className="field-label">Motif{reasonRequired(type) ? ' *' : ' (facultatif)'}</span>
          <input className="name-input" aria-label="Motif du mouvement" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={type === 'damage' ? 'Ex. : sac percé' : type === 'adjustment' ? 'Ex. : comptage physique' : 'Ex. : livraison fournisseur'} />
        </label>
      </div>

      {product && product.sellUnits.length === 0 && <p className="bq-error" role="alert">Ce produit n’a aucune unité : complétez sa fiche produit.</p>}
      {product && levels.status === 'ready' && (
        <p className="bq-hint" aria-label="Aperçu du stock">
          Stock actuel à cet emplacement : {formatQuantity(availableQty)} {baseLabel}
          {check?.ok && <> · après le mouvement : <strong>{formatQuantity(check.stockAfter)} {baseLabel}</strong></>}
        </p>
      )}
      {check && !check.ok && <p className="bq-error" role="alert">{check.message}</p>}
      {check?.ok && check.stockAfter < 0 && (
        <p className="bq-error" role="alert">Le stock deviendrait négatif : la base refusera, sauf si la boutique autorise le stock négatif.</p>
      )}
      {error && <p className="bq-error" role="alert">{error}</p>}

      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Annuler</button>
        <button className="primary-button" disabled={busy || !check?.ok || !locationId} onClick={submit}>{busy ? 'Enregistrement…' : 'Enregistrer le mouvement'}</button>
      </div>
    </section>
  )
}

// ── Historique d'un produit ──────────────────────────────────────────────────

function MovementHistory({ ctx, product, locations, units, onClose }: {
  ctx: BoutiqueContext
  product: { id: string; name: string }
  locations: StockLocation[]
  units: Unit[]
  onClose: () => void
}) {
  const history = useAsync(() => listProductMovements(ctx.client, ctx.siteId, product.id), [ctx.client, ctx.siteId, product.id])
  const locationName = (id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? 'Emplacement inconnu' : 'Sans emplacement')
  const unitLabel = (id: string | null) => (id ? units.find((u) => u.id === id)?.label ?? '' : '')

  return (
    <section className="bq-card bq-stack" aria-label={`Historique de ${product.name}`}>
      <div className="bq-row">
        <h2 className="bq-subtitle bq-grow">Mouvements : {product.name}</h2>
        <button className="text-button" aria-label="Fermer l’historique" onClick={onClose}><X size={16} /></button>
      </div>
      {history.status === 'loading' && <Loading />}
      {history.status === 'error' && <ErrorPanel message={history.message} onRetry={history.reload} />}
      {history.status === 'ready' && history.data.length === 0 && <Empty title="Aucun mouvement pour ce produit." />}
      {history.status === 'ready' && history.data.length > 0 && (
        <div className="bq-table-wrap">
          <table className="bq-table">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Emplacement</th><th scope="col" className="num">Quantité saisie</th><th scope="col" className="num">Variation (base)</th><th scope="col">Motif</th></tr>
            </thead>
            <tbody>
              {history.data.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.created_at).toLocaleString('fr-FR')}</td>
                  <td>{MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}</td>
                  <td>{locationName(m.stock_location_id)}</td>
                  <td className="num">{m.unit_quantity === null ? '—' : `${formatQuantity(m.unit_quantity)} ${unitLabel(m.unit_id)}`}</td>
                  <td className="num">{m.quantity_delta > 0 ? '+' : ''}{formatQuantity(m.quantity_delta)}</td>
                  <td>{m.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="bq-hint">Les 50 derniers mouvements. Les ventes et leurs annulations apparaissent aussi.</p>
    </section>
  )
}
