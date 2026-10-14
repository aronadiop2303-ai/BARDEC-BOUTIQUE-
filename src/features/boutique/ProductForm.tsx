import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { formatMoney, parseMoney } from '../../domain/hardware/money'
import { indicativeUnitPrice, tierLabel } from '../../domain/hardware/pricing'
import { PRODUCT_ATTRIBUTES } from '../../domain/hardware/starter'
import { baseSellUnit, formatQuantity, type Unit } from '../../domain/hardware/units'
import { boutiquePath, navigate } from '../../lib/router'
import { buildFamilyTree, flattenFamilies, listFamilies } from '../../lib/store/categories'
import {
  getProduct, RELATION_TYPES, saveProduct, searchProducts, setProductStatus, STATUS_LABELS,
  type ProductDetail, type ProductDraft, type RelationType,
} from '../../lib/store/products'
import { listUnits } from '../../lib/store/units'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

const EMPTY_SERVICE = { warranty_duration_days: null, warranty_terms: null, return_window_days: null }

function draftFrom(product: ProductDetail | null): ProductDraft {
  if (!product) {
    return {
      name: '', sku: '', barcode: '', categoryId: null, status: 'draft', price: '', description: '', trackInventory: true,
      attributes: {}, sellUnits: [], tiers: [], compatibilities: [], service: { ...EMPTY_SERVICE },
    }
  }
  return {
    name: product.name,
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    categoryId: product.category_id,
    status: product.status,
    price: String(product.price),
    description: product.description ?? '',
    trackInventory: product.track_inventory,
    attributes: { ...product.attributes },
    sellUnits: product.sellUnits.map((u) => ({ ...u })),
    tiers: product.tiers.map((t) => ({ ...t, valid_from: t.valid_from?.slice(0, 10) ?? null, valid_until: t.valid_until?.slice(0, 10) ?? null })),
    compatibilities: product.compatibilities.map((c) => ({ ...c })),
    service: product.service ? { ...product.service } : { ...EMPTY_SERVICE },
  }
}

const toNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value.replace(',', '.')))
const toDays = (value: string) => (value.trim() === '' ? null : Number(value))

export default function ProductForm({ ctx, productId }: { ctx: BoutiqueContext; productId: string | null }) {
  const data = useAsync(async () => {
    const [product, units, families] = await Promise.all([
      productId ? getProduct(ctx.client, ctx.siteId, productId) : Promise.resolve(null),
      listUnits(ctx.client, ctx.siteId),
      listFamilies(ctx.client, ctx.siteId),
    ])
    return { product, units, families }
  }, [ctx.client, ctx.siteId, productId])

  if (data.status === 'loading') return <Loading label="Chargement de la fiche produit…" />
  if (data.status === 'error') return <ErrorPanel message={data.message} onRetry={data.reload} />
  if (productId && !data.data.product) {
    return <div className="empty-state" role="alert"><strong>Produit introuvable.</strong><a className="text-button" href={boutiquePath(ctx.siteId, 'produits')}>Retour aux produits</a></div>
  }
  if (!productId && !ctx.can.editCatalog) {
    return <div className="empty-state" role="alert"><strong>Votre rôle ne permet pas de créer un produit.</strong></div>
  }
  return <ProductEditor key={data.data.product?.id ?? 'new'} ctx={ctx} product={data.data.product} units={data.data.units} families={data.data.families} onSaved={data.reload} />
}

function ProductEditor({ ctx, product, units, families, onSaved }: {
  ctx: BoutiqueContext
  product: ProductDetail | null
  units: Unit[]
  families: Awaited<ReturnType<typeof listFamilies>>
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(() => draftFrom(product))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const readOnly = !ctx.can.editCatalog
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const familyOptions = useMemo(() => flattenFamilies(buildFamilyTree(families)), [families])
  const base = baseSellUnit(draft.sellUnits)
  const baseLabel = base ? unitById.get(base.unit_id)?.label ?? 'unité de base' : 'unité de base'
  const basePrice = parseMoney(draft.price)

  const set = (patch: Partial<ProductDraft>) => { setDraft((current) => ({ ...current, ...patch })); setNotice('') }

  async function save() {
    setError('')
    setNotice('')
    setSaving(true)
    try {
      const id = await saveProduct(ctx.client, ctx.siteId, draft, product)
      if (!product) navigate(boutiquePath(ctx.siteId, 'produits', id))
      else { setNotice('Modifications enregistrées.'); onSaved() }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(status: 'archived' | 'draft') {
    if (!product) return
    if (status === 'archived' && !window.confirm(`Archiver « ${product.name} » ? Il ne sera plus proposé, mais reste dans l’historique.`)) return
    setError('')
    try {
      await setProductStatus(ctx.client, ctx.siteId, product.id, status)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Changement de statut impossible.')
    }
  }

  const unusedUnits = units.filter((u) => !draft.sellUnits.some((s) => s.unit_id === u.id))

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div>
          <a className="text-button" href={boutiquePath(ctx.siteId, 'produits')}><ArrowLeft size={14} /> Produits</a>
          <h1 className="bq-title">{product ? product.name : 'Nouveau produit'}</h1>
          {product && <span className={`bq-badge bq-badge-${product.status}`}>{STATUS_LABELS[product.status]}</span>}
        </div>
        {product && ctx.can.archiveProducts && (product.status === 'archived'
          ? <button className="secondary-button" onClick={() => changeStatus('draft')}><RotateCcw size={15} /> Restaurer en brouillon</button>
          : <button className="secondary-button" onClick={() => changeStatus('archived')}><Archive size={15} /> Archiver</button>)}
      </div>

      {readOnly && <p className="notice" role="status">Consultation seule : votre rôle ne permet pas de modifier le catalogue.</p>}

      <fieldset className="bq-fieldset" disabled={readOnly || saving}>
        <section className="bq-card">
          <h2 className="bq-subtitle">Informations</h2>
          <div className="bq-form-grid">
            <div className="bq-field bq-span-2">
              <label className="field-label" htmlFor="p-name">Nom *</label>
              <input id="p-name" className="name-input" maxLength={180} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex. : Ciment CPJ 45 – sac 50 kg" />
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="p-sku">Référence (SKU)</label>
              <input id="p-sku" className="name-input" value={draft.sku} onChange={(e) => set({ sku: e.target.value })} />
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="p-barcode">Code-barres</label>
              <input id="p-barcode" className="name-input" inputMode="numeric" value={draft.barcode} onChange={(e) => set({ barcode: e.target.value })} />
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="p-family">Famille</label>
              <select id="p-family" className="name-input" value={draft.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
                <option value="">Sans famille</option>
                {familyOptions.map((f) => <option key={f.id} value={f.id}>{'— '.repeat(f.depth)}{f.name}</option>)}
              </select>
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="p-status">Statut</label>
              <select id="p-status" className="name-input" value={draft.status} onChange={(e) => set({ status: e.target.value as ProductDraft['status'] })}>
                <option value="draft">Brouillon</option>
                <option value="active">Actif</option>
                <option value="archived">Archivé</option>
              </select>
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="p-price">Prix de vente par {baseLabel} (FCFA) *</label>
              <input id="p-price" className="name-input" inputMode="numeric" value={draft.price} onChange={(e) => set({ price: e.target.value })} placeholder="Ex. : 100" />
            </div>
            <div className="bq-field">
              <span className="field-label">Prix d’achat et marge</span>
              <p className="bq-hint">Non disponibles : la base n’a pas encore de prix d’achat ni de coût moyen (jalon Q2). Aucune marge n’est estimée.</p>
            </div>
            <label className="bq-check-inline bq-span-2">
              <input type="checkbox" checked={draft.trackInventory} onChange={(e) => set({ trackInventory: e.target.checked })} />
              Suivre le stock de ce produit
            </label>
            <div className="bq-field bq-span-2">
              <label className="field-label" htmlFor="p-description">Description</label>
              <textarea id="p-description" className="name-input bq-textarea" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="bq-card">
          <h2 className="bq-subtitle">Unités de vente et conversions</h2>
          <p className="bq-hint">L’unité de base est celle dont la conversion vaut 1 : le stock est compté dans cette unité. Ex. câble : base « Mètre » ; « Rouleau » = 100. Ciment : base « Kilogramme » ; « Sac » = 50.</p>
          {draft.sellUnits.length === 0 && <p className="bq-muted">Aucune unité de vente. Ajoutez d’abord l’unité de base.</p>}
          {draft.sellUnits.map((row, index) => {
            const unit = unitById.get(row.unit_id)
            const update = (patch: Partial<typeof row>) => set({ sellUnits: draft.sellUnits.map((r, i) => (i === index ? { ...r, ...patch } : r)) })
            return (
              <div className="bq-row" key={row.id ?? `new-${index}`}>
                <label className="bq-inline-field"><span>Unité</span>
                  <select value={row.unit_id} onChange={(e) => update({ unit_id: e.target.value })}>
                    {[unit, ...unusedUnits].filter(Boolean).map((u) => <option key={u!.id} value={u!.id}>{u!.label}</option>)}
                  </select>
                </label>
                <label className="bq-inline-field"><span>= combien de {baseLabel}</span>
                  <input type="number" min="0" step="any" value={Number.isNaN(row.conversion_to_base) ? '' : row.conversion_to_base} onChange={(e) => update({ conversion_to_base: toNumber(e.target.value) })} />
                </label>
                <label className="bq-inline-field"><span>Minimum</span>
                  <input type="number" min="0" step="any" value={Number.isNaN(row.min_sale_quantity) ? '' : row.min_sale_quantity} onChange={(e) => update({ min_sale_quantity: toNumber(e.target.value) })} />
                </label>
                <label className="bq-inline-field"><span>Pas</span>
                  <input type="number" min="0" step="any" value={Number.isNaN(row.quantity_step) ? '' : row.quantity_step} onChange={(e) => update({ quantity_step: toNumber(e.target.value) })} />
                </label>
                <label className="bq-check-inline"><input type="radio" name="default-unit" checked={row.is_default} onChange={() => set({ sellUnits: draft.sellUnits.map((r, i) => ({ ...r, is_default: i === index })) })} /> Par défaut</label>
                {row.conversion_to_base === 1 && <span className="bq-badge bq-badge-active">Base</span>}
                {basePrice !== null && row.conversion_to_base > 0 && <span className="bq-muted">≈ {formatMoney(basePrice * row.conversion_to_base)} / {unit?.label ?? 'unité'}</span>}
                <button type="button" className="icon-button" aria-label={`Retirer l’unité ${unit?.label ?? ''}`} onClick={() => set({ sellUnits: draft.sellUnits.filter((_, i) => i !== index), tiers: draft.tiers.filter((t) => t.unit_id !== row.unit_id) })}><Trash2 size={15} /></button>
              </div>
            )
          })}
          {units.length === 0
            ? <p className="bq-hint">Aucune unité définie pour cette boutique : relancez la configuration depuis les paramètres.</p>
            : unusedUnits.length > 0 && (
              <button type="button" className="secondary-button" onClick={() => set({ sellUnits: [...draft.sellUnits, { unit_id: unusedUnits[0].id, conversion_to_base: draft.sellUnits.length === 0 ? 1 : Number.NaN, min_sale_quantity: 1, quantity_step: 1, is_default: draft.sellUnits.length === 0 }] })}>
                <Plus size={15} /> Ajouter une unité de vente
              </button>
            )}
        </section>

        <section className="bq-card">
          <h2 className="bq-subtitle">Paliers de prix (détail, demi-gros, gros)</h2>
          <p className="bq-hint">À partir d’une quantité minimale, un prix unitaire différent s’applique. Les montants des ventes seront recalculés par la base (Q3).</p>
          {draft.tiers.map((tier, index) => {
            const update = (patch: Partial<typeof tier>) => set({ tiers: draft.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
            const rank = draft.tiers.filter((t) => t.unit_id === tier.unit_id && t.min_quantity < tier.min_quantity).length
            return (
              <div className="bq-row" key={tier.id ?? `tier-${index}`}>
                <span className="bq-badge">{tierLabel(rank)}</span>
                <label className="bq-inline-field"><span>Unité</span>
                  <select value={tier.unit_id ?? ''} onChange={(e) => update({ unit_id: e.target.value })}>
                    {draft.sellUnits.map((s) => <option key={s.unit_id} value={s.unit_id}>{unitById.get(s.unit_id)?.label ?? '?'}</option>)}
                  </select>
                </label>
                <label className="bq-inline-field"><span>À partir de</span>
                  <input type="number" min="0" step="any" value={Number.isNaN(tier.min_quantity) ? '' : tier.min_quantity} onChange={(e) => update({ min_quantity: toNumber(e.target.value) })} />
                </label>
                <label className="bq-inline-field"><span>Prix unitaire (FCFA)</span>
                  <input type="number" min="0" step="1" value={Number.isNaN(tier.unit_price) ? '' : tier.unit_price} onChange={(e) => update({ unit_price: toNumber(e.target.value) })} />
                </label>
                <label className="bq-inline-field"><span>Du</span><input type="date" value={tier.valid_from ?? ''} onChange={(e) => update({ valid_from: e.target.value || null })} /></label>
                <label className="bq-inline-field"><span>Au</span><input type="date" value={tier.valid_until ?? ''} onChange={(e) => update({ valid_until: e.target.value || null })} /></label>
                <button type="button" className="icon-button" aria-label="Retirer le palier" onClick={() => set({ tiers: draft.tiers.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
              </div>
            )
          })}
          {draft.sellUnits.length === 0
            ? <p className="bq-muted">Ajoutez une unité de vente avant de définir des paliers.</p>
            : <button type="button" className="secondary-button" onClick={() => set({ tiers: [...draft.tiers, { unit_id: (draft.sellUnits.find((s) => s.is_default) ?? draft.sellUnits[0]).unit_id, min_quantity: Number.NaN, unit_price: Number.NaN, valid_from: null, valid_until: null }] })}><Plus size={15} /> Ajouter un palier</button>}
          <PricePreview draft={draft} unitById={unitById} />
        </section>

        <section className="bq-card">
          <h2 className="bq-subtitle">Caractéristiques</h2>
          <div className="bq-form-grid">
            {PRODUCT_ATTRIBUTES.map((attribute) => (
              <div className="bq-field" key={attribute.key}>
                <label className="field-label" htmlFor={`attr-${attribute.key}`}>{attribute.label}</label>
                <input id={`attr-${attribute.key}`} className="name-input" value={draft.attributes[attribute.key] ?? ''} onChange={(e) => set({ attributes: { ...draft.attributes, [attribute.key]: e.target.value } })} />
              </div>
            ))}
          </div>
        </section>

        <CompatibilityEditor ctx={ctx} productId={product?.id} draft={draft} set={set} />

        <section className="bq-card">
          <h2 className="bq-subtitle">Garantie et retours</h2>
          <div className="bq-form-grid">
            <div className="bq-field">
              <label className="field-label" htmlFor="w-days">Garantie (jours)</label>
              <input id="w-days" className="name-input" type="number" min="0" step="1" value={draft.service.warranty_duration_days ?? ''} onChange={(e) => set({ service: { ...draft.service, warranty_duration_days: toDays(e.target.value) } })} />
            </div>
            <div className="bq-field">
              <label className="field-label" htmlFor="r-days">Délai de retour (jours)</label>
              <input id="r-days" className="name-input" type="number" min="0" step="1" value={draft.service.return_window_days ?? ''} onChange={(e) => set({ service: { ...draft.service, return_window_days: toDays(e.target.value) } })} />
            </div>
            <div className="bq-field bq-span-2">
              <label className="field-label" htmlFor="w-terms">Conditions de garantie</label>
              <textarea id="w-terms" className="name-input bq-textarea" value={draft.service.warranty_terms ?? ''} onChange={(e) => set({ service: { ...draft.service, warranty_terms: e.target.value } })} />
            </div>
          </div>
        </section>
      </fieldset>

      {error && <p role="alert" className="bq-error">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {!readOnly && (
        <div className="modal-actions bq-sticky-actions">
          <a className="secondary-button" href={boutiquePath(ctx.siteId, 'produits')}>Annuler</a>
          <button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : product ? 'Enregistrer les modifications' : 'Créer le produit'}</button>
        </div>
      )}
    </div>
  )
}

/** Aperçu indicatif du prix par unité de vente pour quelques quantités (aucun montant n'est enregistré). */
function PricePreview({ draft, unitById }: { draft: ProductDraft; unitById: Map<string, Unit> }) {
  const basePrice = parseMoney(draft.price)
  if (basePrice === null || draft.sellUnits.length === 0) return null
  return (
    <div className="bq-preview" aria-label="Aperçu des prix">
      <strong>Aperçu indicatif</strong>
      {draft.sellUnits.filter((s) => s.conversion_to_base > 0).map((s) => {
        const tiersOfUnit = draft.tiers.filter((t) => t.unit_id === s.unit_id && t.min_quantity > 0 && t.unit_price >= 0)
        const quantities = [...new Set([s.min_sale_quantity, ...tiersOfUnit.map((t) => t.min_quantity)])].filter((q) => q > 0).sort((a, b) => a - b)
        const label = unitById.get(s.unit_id)?.label ?? 'unité'
        return (
          <p key={s.unit_id}>
            {label} : {quantities.map((q) => {
              const { unitPrice } = indicativeUnitPrice({ basePrice, conversionToBase: s.conversion_to_base, tiers: tiersOfUnit, unitId: s.unit_id, quantity: q })
              return `${formatQuantity(q)} et plus → ${formatMoney(unitPrice)}`
            }).join(' · ')}
          </p>
        )
      })}
    </div>
  )
}

function CompatibilityEditor({ ctx, productId, draft, set }: {
  ctx: BoutiqueContext
  productId: string | undefined
  draft: ProductDraft
  set: (patch: Partial<ProductDraft>) => void
}) {
  const [query, setQuery] = useState('')
  const [relation, setRelation] = useState<RelationType>('replacement_for')
  const debounced = useDebounced(query, 300)
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!debounced.trim()) { setResults([]); return }
    searchProducts(ctx.client, ctx.siteId, debounced, productId)
      .then((rows) => { if (!cancelled) { setResults(rows); setSearchError('') } })
      .catch((reason: unknown) => { if (!cancelled) setSearchError(reason instanceof Error ? reason.message : 'Recherche impossible.') })
    return () => { cancelled = true }
  }, [ctx.client, ctx.siteId, debounced, productId])

  return (
    <section className="bq-card">
      <h2 className="bq-subtitle">Compatibilités et produits de substitution</h2>
      <p className="bq-hint">Proposés au vendeur en cas de rupture (ex. un tuyau PVC 32 d’une autre marque).</p>
      {draft.compatibilities.length === 0 && <p className="bq-muted">Aucune relation.</p>}
      {draft.compatibilities.map((item, index) => (
        <div className="bq-row" key={`${item.compatible_product_id}-${item.relation_type}`}>
          <select aria-label="Type de relation" value={item.relation_type} onChange={(e) => set({ compatibilities: draft.compatibilities.map((c, i) => (i === index ? { ...c, relation_type: e.target.value as RelationType } : c)) })}>
            {Object.entries(RELATION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <strong>{item.compatible_product_name}</strong>
          <button type="button" className="icon-button" aria-label={`Retirer ${item.compatible_product_name ?? ''}`} onClick={() => set({ compatibilities: draft.compatibilities.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="bq-row">
        <select aria-label="Type de relation à ajouter" value={relation} onChange={(e) => setRelation(e.target.value as RelationType)}>
          {Object.entries(RELATION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input className="name-input bq-grow" aria-label="Rechercher un produit lié" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit…" />
      </div>
      {searchError && <p role="alert" className="bq-error">{searchError}</p>}
      {results.length > 0 && (
        <ul className="bq-results">
          {results.map((row) => (
            <li key={row.id}>
              <button type="button" className="text-button" onClick={() => {
                if (!draft.compatibilities.some((c) => c.compatible_product_id === row.id && c.relation_type === relation)) {
                  set({ compatibilities: [...draft.compatibilities, { compatible_product_id: row.id, compatible_product_name: row.name, relation_type: relation, notes: null }] })
                }
                setQuery('')
              }}><Plus size={13} /> {row.name}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
