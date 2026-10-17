import { useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Clock, ImageOff, MapPin, MessageCircle, Phone, Search } from 'lucide-react'
import { formatMoney } from '../../domain/hardware/money'
import { availabilityLabel, orderMessage, topCategories, whatsappOrderUrl } from '../../domain/storefront/storefront'
import { storefrontPath } from '../../lib/router'
import { getCategories, getProduct, getProducts, getShop, PAGE_SIZE, StorefrontNotInstalledError, type StoreProduct, type StoreShop } from '../../lib/storefront'
import { useAsync, useDebounced } from '../../lib/useAsync'

type Props = { client: SupabaseClient; siteId: string; view: 'home' | 'category' | 'product'; param: string | null }

/**
 * Boutique en ligne, lecture seule : accueil, catalogue par famille, fiche produit, coordonnées,
 * bouton WhatsApp « Commander ». Pas de paiement en ligne, pas de panier.
 */
export default function StorefrontPage({ client, siteId, view, param }: Props) {
  const shop = useAsync(async () => {
    const [info, categories] = await Promise.all([getShop(client, siteId), getCategories(client, siteId)])
    return { info, categories }
  }, [client, siteId])

  if (shop.status === 'loading') return <div className="sf-page"><p className="sf-muted" role="status">Chargement de la boutique…</p></div>
  if (shop.status === 'error') {
    return (
      <div className="sf-page">
        <div className="empty-state" role="alert">
          <strong>Boutique indisponible.</strong>
          <span>{shop.message}</span>
          {!(shop.message === new StorefrontNotInstalledError().message) && <button className="secondary-button" onClick={shop.reload}>Réessayer</button>}
        </div>
      </div>
    )
  }
  const { info, categories } = shop.data
  if (!info) {
    return (
      <div className="sf-page">
        <div className="empty-state" role="status">
          <strong>Cette boutique n’est pas en ligne.</strong>
          <span>Elle n’existe pas ou n’a pas encore été publiée par son propriétaire.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sf-page">
      {!info.published && (
        <p className="notice" role="note">Aperçu : cette boutique n’est pas publiée. Vous seul (propriétaire ou gérant connecté) la voyez.</p>
      )}
      <header className="sf-header">
        <a className="sf-brand" href={storefrontPath(siteId)}>{info.name}</a>
        <WhatsappButton shop={info} product={null} label="Commander sur WhatsApp" />
      </header>
      <div className="sf-layout">
        <nav className="sf-categories" aria-label="Familles">
          <a href={storefrontPath(siteId)} aria-current={view === 'home' ? 'page' : undefined}>Tous les produits</a>
          {topCategories(categories).map((c) => (
            <a key={c.id} href={storefrontPath(siteId, 'category', c.id)} aria-current={view === 'category' && param === c.id ? 'page' : undefined}>
              {c.name} <small>({c.product_count})</small>
            </a>
          ))}
        </nav>
        <main className="sf-main">
          {view === 'product' && param
            ? <ProductView client={client} siteId={siteId} slug={param} shop={info} />
            : <Catalog client={client} siteId={siteId} categoryId={view === 'category' ? param : null}
                title={view === 'category' ? categories.find((c) => c.id === param)?.name ?? 'Famille' : 'Nos produits'} />}
        </main>
      </div>
      <Contact shop={info} />
    </div>
  )
}

function Catalog({ client, siteId, categoryId, title }: { client: SupabaseClient; siteId: string; categoryId: string | null; title: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const term = useDebounced(search, 300)
  const products = useAsync(() => getProducts(client, siteId, { categoryId, search: term, page }), [client, siteId, categoryId, term, page])

  return (
    <section className="sf-stack" aria-label={title}>
      <div className="sf-row">
        <h1 className="sf-title">{title}</h1>
        <label className="search-box sf-search">
          <Search size={16} />
          <input aria-label="Rechercher un produit" value={search} placeholder="Rechercher…" onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
        </label>
      </div>
      {products.status === 'loading' && <p className="sf-muted" role="status">Chargement…</p>}
      {products.status === 'error' && <p className="bq-error" role="alert">{products.message}</p>}
      {products.status === 'ready' && products.data.length === 0 && <p className="sf-muted">Aucun produit à afficher.</p>}
      {products.status === 'ready' && products.data.length > 0 && (
        <>
          <ul className="sf-grid">
            {products.data.map((p) => <ProductCard key={p.id} siteId={siteId} product={p} />)}
          </ul>
          <div className="sf-row">
            {page > 0 && <button className="secondary-button" onClick={() => setPage(page - 1)}>Précédent</button>}
            {products.data.length === PAGE_SIZE && <button className="secondary-button" onClick={() => setPage(page + 1)}>Suivant</button>}
          </div>
        </>
      )}
    </section>
  )
}

function Photo({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) return <div className="sf-photo sf-photo-empty" aria-label={`Pas de photo pour ${name}`}><ImageOff size={22} /></div>
  return <img className="sf-photo" src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}

function ProductCard({ siteId, product }: { siteId: string; product: StoreProduct }) {
  return (
    <li className="sf-card">
      <a href={storefrontPath(siteId, 'product', product.slug)}>
        <Photo url={product.image_url} name={product.name} />
        <strong>{product.name}</strong>
      </a>
      <span className="sf-price">{formatMoney(product.price, product.currency_code)}{product.unit_label ? <small> / {product.unit_label}</small> : null}</span>
      <span className={`sf-availability sf-${product.availability}`}>{availabilityLabel(product.availability)}</span>
    </li>
  )
}

function ProductView({ client, siteId, slug, shop }: { client: SupabaseClient; siteId: string; slug: string; shop: StoreShop }) {
  const product = useAsync(() => getProduct(client, siteId, slug), [client, siteId, slug])
  if (product.status === 'loading') return <p className="sf-muted" role="status">Chargement…</p>
  if (product.status === 'error') return <p className="bq-error" role="alert">{product.message}</p>
  if (!product.data) return <p className="sf-muted" role="status">Ce produit n’est pas disponible en ligne.</p>
  const p = product.data
  const attributes = Object.entries(p.attributes).filter(([, v]) => typeof v === 'string' && v.trim())
  return (
    <article className="sf-product" aria-label={p.name}>
      <a className="text-button" href={p.category_id ? storefrontPath(siteId, 'category', p.category_id) : storefrontPath(siteId)}>
        <ArrowLeft size={15} /> {p.category_name ?? 'Tous les produits'}
      </a>
      <div className="sf-product-body">
        <Photo url={p.image_url} name={p.name} />
        <div className="sf-stack">
          <h1 className="sf-title">{p.name}</h1>
          <span className="sf-price sf-price-lg">{formatMoney(p.price, p.currency_code)}{p.unit_label ? <small> / {p.unit_label}</small> : null}</span>
          <span className={`sf-availability sf-${p.availability}`}>{availabilityLabel(p.availability)}</span>
          {p.description && <p>{p.description}</p>}
          {attributes.length > 0 && (
            <dl className="sf-attributes">{attributes.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          )}
          <WhatsappButton shop={shop} product={{ name: p.name, price: p.price, currency: p.currency_code, unit: p.unit_label }} label="Commander sur WhatsApp" />
          <small className="sf-muted">Prix indicatif affiché par la boutique. Paiement et livraison à convenir avec elle : aucun paiement en ligne.</small>
        </div>
      </div>
    </article>
  )
}

function WhatsappButton({ shop, product, label }: { shop: StoreShop; product: Parameters<typeof orderMessage>[1]; label: string }) {
  const href = useMemo(
    () => whatsappOrderUrl(shop.whatsapp || shop.phone, orderMessage(shop.name, product, typeof window !== 'undefined' ? window.location.href : '')),
    [shop, product],
  )
  if (!href) return null
  return (
    <a className="primary-button sf-whatsapp" href={href} target="_blank" rel="noreferrer noopener">
      <MessageCircle size={16} /> {label}
    </a>
  )
}

function Contact({ shop }: { shop: StoreShop }) {
  const place = [shop.address, shop.city].filter(Boolean).join(', ')
  return (
    <footer className="sf-footer" aria-label="Coordonnées">
      <strong>{shop.name}</strong>
      {place && <span><MapPin size={14} /> {place}</span>}
      {shop.phone && <span><Phone size={14} /> <a href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}>{shop.phone}</a></span>}
      {shop.opening_hours && <span><Clock size={14} /> {shop.opening_hours}</span>}
      {shop.email && <span><a href={`mailto:${shop.email}`}>{shop.email}</a></span>}
    </footer>
  )
}
