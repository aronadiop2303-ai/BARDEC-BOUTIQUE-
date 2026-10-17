import { useState } from 'react'
import { ExternalLink, Globe2 } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { getShop, setPublished, storefrontUrl, StorefrontNotInstalledError } from '../../lib/storefront'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/**
 * Site public : aperçu (propriétaire et gérant), publication et dépublication (propriétaire seulement),
 * avec confirmation explicite par saisie du nom de la boutique. Rien n'est publié automatiquement.
 */
export default function PublicSitePage({ ctx }: { ctx: BoutiqueContext }) {
  const state = useAsync(async () => {
    try {
      return { installed: true as const, shop: await getShop(ctx.client, ctx.siteId) }
    } catch (error) {
      if (error instanceof StorefrontNotInstalledError) return { installed: false as const, shop: null }
      throw error
    }
  }, [ctx.client, ctx.siteId])
  const [confirming, setConfirming] = useState<'publish' | 'unpublish' | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const siteName = ctx.access.site.name
  const url = storefrontUrl(ctx.siteId)

  const heading = <div className="bq-heading"><div><p className="eyebrow">SITE PUBLIC</p><h1 className="bq-title">Boutique en ligne</h1></div></div>
  if (state.status === 'loading') return <div className="bq-stack">{heading}<Loading /></div>
  if (state.status === 'error') return <div className="bq-stack">{heading}<ErrorPanel message={state.message} onRetry={state.reload} /></div>
  if (!state.data.installed) {
    return (
      <div className="bq-stack">
        {heading}
        <p className="bq-error" role="alert">La boutique en ligne n’est pas encore activée : la migration <code>public_storefront</code> n’est pas appliquée à la base.</p>
      </div>
    )
  }
  const published = state.data.shop?.published === true

  async function confirm() {
    if (!confirming) return
    setBusy(true)
    setMessage(null)
    try {
      await setPublished(ctx.client, ctx.siteId, confirming === 'publish', confirmName)
      setMessage({ kind: 'ok', text: confirming === 'publish' ? 'Boutique publiée : elle est visible sur internet.' : 'Boutique dépubliée : elle n’est plus visible.' })
      setConfirming(null)
      setConfirmName('')
      setChecked(false)
      state.reload()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Action impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bq-stack">
      {heading}
      <section className="bq-card bq-stack" aria-label="État de la boutique en ligne">
        <p className="bq-row">
          <Globe2 size={18} />
          <strong>{published ? 'Publiée : visible par tous sur internet.' : 'Non publiée : invisible pour le public.'}</strong>
        </p>
        <p className="bq-hint">
          Le public voit : nom, photo, prix de vente et disponibilité des produits actifs (sans quantité), familles, coordonnées,
          bouton WhatsApp. Jamais : prix d’achat, stock exact, marges, ventes, clients.
        </p>
        <div className="bq-row">
          <a className="secondary-button" href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} /> {published ? 'Voir la boutique' : 'Aperçu'}</a>
          <input className="bq-grow" readOnly value={url} aria-label="Adresse de la boutique en ligne" />
        </div>
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}
        {!ctx.can.publish && <p className="notice" role="note">Seul le propriétaire peut publier ou dépublier la boutique.</p>}
        {ctx.can.publish && !confirming && (
          <div className="modal-actions">
            {published
              ? <button className="secondary-button" onClick={() => setConfirming('unpublish')}>Dépublier</button>
              : <button className="primary-button" onClick={() => setConfirming('publish')}>Publier</button>}
          </div>
        )}
        {ctx.can.publish && confirming && (
          <div className="notice bq-stack" role="group" aria-label="Confirmation de publication">
            <strong>{confirming === 'publish' ? 'Publier la boutique sur internet ?' : 'Retirer la boutique d’internet ?'}</strong>
            {confirming === 'publish' && (
              <label className="bq-row"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> J’ai vérifié l’aperçu.</label>
            )}
            <label className="bq-inline-field">Pour confirmer, saisissez le nom de la boutique : « {siteName} »
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Nom de la boutique pour confirmer" />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} onClick={() => { setConfirming(null); setConfirmName(''); setChecked(false) }}>Annuler</button>
              <button
                className="primary-button"
                disabled={busy || confirmName.trim() !== siteName.trim() || (confirming === 'publish' && !checked)}
                onClick={confirm}
              >
                {confirming === 'publish' ? 'Confirmer la publication' : 'Confirmer la dépublication'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
