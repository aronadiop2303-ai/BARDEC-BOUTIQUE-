import { Boxes, FolderTree, MapPin, Package, Plus } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { boutiquePath } from '../../lib/router'
import { listFamilies } from '../../lib/store/categories'
import { listProducts } from '../../lib/store/products'
import { countMovements, listLocations } from '../../lib/store/stock'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/** Tableau de bord : uniquement des chiffres réels lus en base, aucun indicateur inventé. */
export default function Dashboard({ ctx }: { ctx: BoutiqueContext }) {
  const stats = useAsync(async () => {
    const [active, draft, families, locations, movements] = await Promise.all([
      listProducts(ctx.client, ctx.siteId, { status: 'active', pageSize: 1 }),
      listProducts(ctx.client, ctx.siteId, { status: 'draft', pageSize: 1 }),
      listFamilies(ctx.client, ctx.siteId),
      listLocations(ctx.client, ctx.siteId),
      countMovements(ctx.client, ctx.siteId),
    ])
    return {
      active: active.total,
      draft: draft.total,
      families: families.filter((f) => f.is_active).length,
      locations: locations.filter((l) => l.is_active).length,
      movements,
    }
  }, [ctx.client, ctx.siteId])

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div>
          <p className="eyebrow">ESPACE DE GESTION</p>
          <h1 className="bq-title">Tableau de bord</h1>
        </div>
        {ctx.can.editCatalog && <a className="primary-button" href={boutiquePath(ctx.siteId, 'produits', 'nouveau')}><Plus size={16} /> Nouveau produit</a>}
      </div>

      {stats.status === 'loading' && <Loading />}
      {stats.status === 'error' && <ErrorPanel message={stats.message} onRetry={stats.reload} />}
      {stats.status === 'ready' && (
        <section className="stats-grid bq-stats" aria-label="Résumé de la boutique">
          <article className="stat-card"><div className="stat-icon stat-blue"><Package size={18} /></div><span className="stat-label">Produits actifs</span><strong>{stats.data.active}</strong><small>{stats.data.draft} en brouillon</small></article>
          <article className="stat-card"><div className="stat-icon stat-purple"><FolderTree size={18} /></div><span className="stat-label">Familles actives</span><strong>{stats.data.families}</strong><small>Arborescence modifiable</small></article>
          <article className="stat-card"><div className="stat-icon stat-green"><MapPin size={18} /></div><span className="stat-label">Emplacements de stock</span><strong>{stats.data.locations}</strong><small>Magasin, dépôt…</small></article>
          <article className="stat-card"><div className="stat-icon stat-blue"><Boxes size={18} /></div><span className="stat-label">Mouvements de stock</span><strong>{stats.data.movements}</strong><small>Saisie : jalon Q2</small></article>
        </section>
      )}

      <section className="bq-card">
        <h2 className="bq-subtitle">Ce qui est disponible</h2>
        <ul className="bq-list">
          <li><strong>Catalogue</strong> : produits, unités de vente et conversions, paliers de prix, compatibilités, garantie.</li>
          <li><strong>Familles</strong> : arborescence modifiable.</li>
          <li><strong>Stock</strong> : consultation par produit et par emplacement à partir du registre.</li>
        </ul>
        <h2 className="bq-subtitle">Pas encore disponible</h2>
        <ul className="bq-list muted">
          <li>Saisie du stock, prix d’achat et marge (Q2).</li>
          <li>Ventes et caisse (Q3) : écran prêt, actif seulement après application de la migration des ventes ; clients, crédit, fournisseurs (Q4) ; devis et documents (Q5) ; rapports et équipe (Q6).</li>
        </ul>
      </section>
    </div>
  )
}
