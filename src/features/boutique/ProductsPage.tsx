import { useMemo, useState } from 'react'
import { Plus, Search, Upload } from 'lucide-react'
import { Empty, ErrorPanel, Loading, Pagination } from '../../components/StatePanel'
import { formatMoney } from '../../domain/hardware/money'
import { boutiquePath } from '../../lib/router'
import { buildFamilyTree, familyWithDescendants, flattenFamilies, listFamilies } from '../../lib/store/categories'
import { listProducts, STATUS_LABELS, type ProductQuery } from '../../lib/store/products'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

const PAGE_SIZE = 20

export default function ProductsPage({ ctx }: { ctx: BoutiqueContext }) {
  const [search, setSearch] = useState('')
  const [familyId, setFamilyId] = useState('')
  const [status, setStatus] = useState<NonNullable<ProductQuery['status']>>('current')
  const [page, setPage] = useState(0)
  const debouncedSearch = useDebounced(search, 300)

  const families = useAsync(() => listFamilies(ctx.client, ctx.siteId), [ctx.client, ctx.siteId])
  const familyRows = families.status === 'ready' ? families.data : []
  const familyOptions = useMemo(() => flattenFamilies(buildFamilyTree(familyRows)), [familyRows])
  const familyNames = useMemo(() => new Map(familyRows.map((f) => [f.id, f.name])), [familyRows])

  const categoryIds = familyId ? familyWithDescendants(familyRows, familyId) : []
  const products = useAsync(
    () => listProducts(ctx.client, ctx.siteId, { search: debouncedSearch, categoryIds, status, page, pageSize: PAGE_SIZE }),
    [ctx.client, ctx.siteId, debouncedSearch, categoryIds.join(','), status, page],
  )

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(0) }
  const filtering = Boolean(debouncedSearch || familyId || status !== 'current')

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div><p className="eyebrow">CATALOGUE</p><h1 className="bq-title">Produits</h1></div>
        <div className="bq-row">
          {ctx.can.importProducts && <a className="secondary-button" href={boutiquePath(ctx.siteId, 'produits', 'import')}><Upload size={16} /> Importer</a>}
          {ctx.can.editCatalog && <a className="primary-button" href={boutiquePath(ctx.siteId, 'produits', 'nouveau')}><Plus size={16} /> Nouveau produit</a>}
        </div>
      </div>

      <div className="bq-filters">
        <label className="search-box bq-search">
          <Search size={17} />
          <input aria-label="Rechercher un produit" value={search} onChange={(e) => resetPage(setSearch)(e.target.value)} placeholder="Nom, référence ou code-barres…" />
        </label>
        <label className="bq-inline-field">
          <span>Famille</span>
          <select value={familyId} onChange={(e) => resetPage(setFamilyId)(e.target.value)}>
            <option value="">Toutes</option>
            {familyOptions.map((f) => <option key={f.id} value={f.id}>{'— '.repeat(f.depth)}{f.name}{f.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>
        <label className="bq-inline-field">
          <span>Statut</span>
          <select value={status} onChange={(e) => resetPage(setStatus)(e.target.value as NonNullable<ProductQuery['status']>)}>
            <option value="current">Brouillons et actifs</option>
            <option value="active">Actifs</option>
            <option value="draft">Brouillons</option>
            <option value="archived">Archivés</option>
            <option value="all">Tous</option>
          </select>
        </label>
      </div>

      {products.status === 'loading' && <Loading label="Chargement des produits…" />}
      {products.status === 'error' && <ErrorPanel message={products.message} onRetry={products.reload} />}
      {products.status === 'ready' && products.data.rows.length === 0 && (
        filtering
          ? <Empty title="Aucun produit ne correspond.">Essayez une autre recherche ou un autre filtre.</Empty>
          : <Empty title="Votre catalogue est vide.">{ctx.can.editCatalog ? 'Ajoutez votre premier produit avec « Nouveau produit ».' : 'Le gérant n’a pas encore ajouté de produit.'}</Empty>
      )}
      {products.status === 'ready' && products.data.rows.length > 0 && (
        <>
          <div className="bq-table-wrap">
            <table className="bq-table">
              <thead><tr><th scope="col">Produit</th><th scope="col">Référence</th><th scope="col">Famille</th><th scope="col" className="num">Prix de base</th><th scope="col">Statut</th></tr></thead>
              <tbody>
                {products.data.rows.map((row) => (
                  <tr key={row.id}>
                    <td><a href={boutiquePath(ctx.siteId, 'produits', row.id)}>{row.name}</a>{row.barcode && <small className="bq-muted"> · {row.barcode}</small>}</td>
                    <td>{row.sku ?? '—'}</td>
                    <td>{row.category_id ? familyNames.get(row.category_id) ?? '—' : '—'}</td>
                    <td className="num">{formatMoney(Number(row.price), row.currency_code)}</td>
                    <td><span className={`bq-badge bq-badge-${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
