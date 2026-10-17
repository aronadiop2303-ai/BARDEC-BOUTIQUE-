import { useEffect, useState } from 'react'
import { setProductImage, StorefrontNotInstalledError } from '../../lib/storefront'
import type { BoutiqueContext } from './context'

/**
 * Photo affichée sur la boutique en ligne : adresse https d'une image déjà hébergée.
 * Pas d'envoi de fichier : un espace de stockage (bucket) est une modification de configuration non autorisée ici.
 */
export default function ProductPhoto({ ctx, productId }: { ctx: BoutiqueContext; productId: string }) {
  const [url, setUrl] = useState('')
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => ctx.client.from('product_images').select('url').eq('product_id', productId).maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setLoaded('unavailable'); return }
        setUrl((data as { url: string } | null)?.url ?? '')
        setLoaded('ready')
      })
      .catch(() => { if (!cancelled) setLoaded('unavailable') })
    return () => { cancelled = true }
  }, [ctx.client, productId])

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      await setProductImage(ctx.client, productId, url)
      setMessage({ kind: 'ok', text: url.trim() ? 'Photo enregistrée.' : 'Photo retirée.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof StorefrontNotInstalledError ? 'Photos indisponibles : la migration public_storefront n’est pas appliquée.' : error instanceof Error ? error.message : 'Enregistrement impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Photo du produit">
      <h2 className="bq-subtitle">Photo (boutique en ligne)</h2>
      {loaded === 'unavailable' && <p className="bq-hint">Photos indisponibles tant que la migration public_storefront n’est pas appliquée.</p>}
      <div className="bq-row">
        <label className="bq-inline-field bq-grow">Adresse de l’image (https://…)
          <input value={url} maxLength={500} disabled={loaded !== 'ready'} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="secondary-button" disabled={busy || loaded !== 'ready' || (url.trim() !== '' && !/^https:\/\/\S+$/.test(url.trim()))} onClick={save}>Enregistrer la photo</button>
      </div>
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
    </section>
  )
}
