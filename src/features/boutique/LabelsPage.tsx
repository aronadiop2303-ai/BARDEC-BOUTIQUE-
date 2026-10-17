import { useEffect, useState } from 'react'
import { ArrowLeft, Printer, Search, Trash2 } from 'lucide-react'
import { barcodeModules, barsFromModules } from '../../domain/barcode/barcode'
import { formatMoney } from '../../domain/hardware/money'
import { boutiquePath } from '../../lib/router'
import { searchSaleProducts, type SaleProduct } from '../../lib/store/pos'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/** Code-barres en SVG (EAN-13 si le code est un EAN valide, sinon Code 128), texte lisible dessous. */
export function BarcodeSvg({ code, height = 40 }: { code: string; height?: number }) {
  let encoded: ReturnType<typeof barcodeModules>
  try {
    encoded = barcodeModules(code)
  } catch {
    return <span className="label-code">{code}</span>
  }
  const quiet = 10
  const width = encoded.modules.length + quiet * 2
  return (
    <svg className="label-barcode" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${encoded.symbology} ${code}`}>
      <rect width={width} height={height} fill="#fff" />
      {barsFromModules(encoded.modules).map((bar) => <rect key={bar.x} x={bar.x + quiet} width={bar.width} height={height} fill="#000" />)}
    </svg>
  )
}

type LabelLine = { product: SaleProduct; copies: number }

/** Étiquettes A4 (3 × 8, 63,5 × 33,9 mm) : nom, prix de vente, code-barres (ou SKU en Code 128). */
export default function LabelsPage({ ctx }: { ctx: BoutiqueContext }) {
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const results = useAsync(() => searchSaleProducts(ctx.client, ctx.siteId, term), [ctx.client, ctx.siteId, term])
  const [lines, setLines] = useState<LabelLine[]>([])
  const [printing, setPrinting] = useState(false)
  const labels = lines.flatMap((l) => Array.from({ length: l.copies }, () => l.product))

  useEffect(() => {
    if (!printing) return
    const timer = setTimeout(() => { window.print(); setPrinting(false) }, 0)
    return () => clearTimeout(timer)
  }, [printing])

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div><p className="eyebrow">CATALOGUE</p><h1 className="bq-title">Étiquettes</h1></div>
        <a className="secondary-button" href={boutiquePath(ctx.siteId, 'produits')}><ArrowLeft size={15} /> Produits</a>
      </div>
      <section className="bq-card bq-stack" aria-label="Produits à étiqueter">
        <label className="search-box bq-search"><Search size={16} />
          <input aria-label="Produit à étiqueter" value={search} placeholder="Nom, référence ou code-barres…" onChange={(e) => setSearch(e.target.value)} />
        </label>
        {term && results.status === 'ready' && results.data.length > 0 && (
          <ul className="bq-tree" aria-label="Produits trouvés">
            {results.data.map((p) => (
              <li key={p.id} className="bq-row"><span className="bq-grow">{p.name}{p.barcode ? <small className="bq-muted"> · {p.barcode}</small> : null}</span>
                <button className="secondary-button" onClick={() => { setLines((list) => [...list.filter((l) => l.product.id !== p.id), { product: p, copies: 1 }]); setSearch('') }}>Ajouter</button>
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <table className="bq-table" aria-label="Étiquettes à imprimer">
            <thead><tr><th scope="col">Produit</th><th scope="col">Code imprimé</th><th scope="col">Exemplaires</th><th scope="col"><span className="sr-only">Retirer</span></th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.product.id}>
                  <td>{l.product.name}</td>
                  <td>{l.product.barcode ?? l.product.sku ?? <span className="bq-error">Ni code-barres ni SKU</span>}</td>
                  <td><input className="bq-qty" inputMode="numeric" aria-label={`Exemplaires de ${l.product.name}`} value={String(l.copies)}
                    onChange={(e) => { const n = Math.max(0, Math.min(240, Number(e.target.value.replace(/\D/g, '')) || 0)); setLines((list) => list.map((x) => (x.product.id === l.product.id ? { ...x, copies: n } : x))) }} /></td>
                  <td><button className="text-button" aria-label={`Retirer ${l.product.name}`} onClick={() => setLines((list) => list.filter((x) => x.product.id !== l.product.id))}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="modal-actions">
          <button className="primary-button" disabled={labels.length === 0} onClick={() => setPrinting(true)}><Printer size={15} /> Imprimer {labels.length} étiquette{labels.length > 1 ? 's' : ''}</button>
        </div>
        <small className="bq-hint">Planche A4 de 24 étiquettes (63,5 × 33,9 mm). Vérifiez l’alignement sur une feuille normale avant d’utiliser les planches adhésives.</small>
      </section>
      {printing && (
        <div className="print-root" aria-hidden="true">
          <style>{'@page { size: A4; margin: 13mm 7mm; }'}</style>
          <div className="label-sheet">
            {labels.map((p, i) => (
              <article key={i} className="label" aria-label={`Étiquette ${p.name}`}>
                <strong className="label-name">{p.name}</strong>
                <span className="label-price">{formatMoney(p.price, p.currency_code)}</span>
                {(p.barcode ?? p.sku) && <BarcodeSvg code={(p.barcode ?? p.sku) as string} />}
                <span className="label-code">{p.barcode ?? p.sku ?? ''}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
