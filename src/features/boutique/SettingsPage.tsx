import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { getSetupStatus, saveBusinessProfile, type ProfileInput } from '../../lib/store/setup'
import { createLocation, listLocations, LOCATION_TYPE_LABELS, setLocationActive, type LocationType } from '../../lib/store/stock'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'
import ProfileFields from './ProfileFields'

export default function SettingsPage({ ctx }: { ctx: BoutiqueContext }) {
  const data = useAsync(async () => {
    const [status, locations] = await Promise.all([getSetupStatus(ctx.client, ctx.siteId), listLocations(ctx.client, ctx.siteId)])
    return { status, locations }
  }, [ctx.client, ctx.siteId])

  if (data.status === 'loading') return <Loading />
  if (data.status === 'error') return <ErrorPanel message={data.message} onRetry={data.reload} />
  return <SettingsForm ctx={ctx} profile={data.data.status.profile} locations={data.data.locations} onChanged={data.reload} />
}

function SettingsForm({ ctx, profile, locations, onChanged }: {
  ctx: BoutiqueContext
  profile: Awaited<ReturnType<typeof getSetupStatus>>['profile']
  locations: Awaited<ReturnType<typeof listLocations>>
  onChanged: () => void
}) {
  const [value, setValue] = useState<ProfileInput>({
    public_name: profile?.public_name ?? '',
    phone: profile?.phone ?? '',
    whatsapp: profile?.whatsapp ?? '',
    address: profile?.address ?? '',
    city: profile?.city ?? '',
    hours: profile?.opening_hours?.text ?? '',
  })
  const [locationName, setLocationName] = useState('')
  const [locationType, setLocationType] = useState<LocationType>('warehouse')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const readOnly = !ctx.can.configure

  async function run(action: () => Promise<void>, success: string) {
    setMessage(null)
    setBusy(true)
    try {
      await action()
      setMessage({ kind: 'ok', text: success })
      onChanged()
    } catch (reason) {
      setMessage({ kind: 'error', text: reason instanceof Error ? reason.message : 'Action impossible.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bq-stack">
      <div className="bq-heading"><div><p className="eyebrow">PARAMÈTRES</p><h1 className="bq-title">Paramètres de la boutique</h1></div></div>
      {readOnly && <p className="notice" role="status">Consultation seule : seuls le propriétaire et le gérant (admin) modifient ces paramètres.</p>}
      {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'notice' : 'bq-error'}>{message.text}</p>}

      <section className="bq-card">
        <h2 className="bq-subtitle">Profil public</h2>
        <ProfileFields value={value} onChange={setValue} disabled={readOnly || busy} />
        {!readOnly && (
          <div className="modal-actions">
            <button className="primary-button" disabled={busy} onClick={() => run(() => saveBusinessProfile(ctx.client, ctx.siteId, value), 'Profil enregistré.')}>Enregistrer le profil</button>
          </div>
        )}
      </section>

      <section className="bq-card">
        <h2 className="bq-subtitle">Emplacements de stock</h2>
        <ul className="bq-tree">
          {locations.map((location) => (
            <li key={location.id} className={location.is_active ? '' : 'inactive'}>
              <div className="bq-row">
                <strong className="bq-grow">{location.name} <small className="bq-muted">· {LOCATION_TYPE_LABELS[location.location_type]}{location.is_active ? '' : ' · désactivé'}</small></strong>
                {!readOnly && (
                  <button className="text-button" disabled={busy} onClick={() => run(() => setLocationActive(ctx.client, ctx.siteId, location.id, !location.is_active), location.is_active ? 'Emplacement désactivé.' : 'Emplacement réactivé.')}>
                    {location.is_active ? 'Désactiver' : 'Réactiver'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="bq-row">
            <input className="name-input bq-grow" aria-label="Nom du nouvel emplacement" maxLength={120} value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Ex. : Dépôt de Pikine" />
            <select aria-label="Type d’emplacement" value={locationType} onChange={(e) => setLocationType(e.target.value as LocationType)}>
              {Object.entries(LOCATION_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button className="primary-button" disabled={busy} onClick={() => run(async () => { await createLocation(ctx.client, ctx.siteId, { name: locationName, location_type: locationType }); setLocationName('') }, 'Emplacement ajouté.')}>
              <Plus size={15} /> Ajouter
            </button>
          </div>
        )}
      </section>

      <section className="bq-card">
        <h2 className="bq-subtitle">Documents et taxes</h2>
        <p className="bq-hint">Réglages des documents créés par défaut (ticket 80 mm). Modèles de reçu, facture et numérotation : jalons Q3 et Q5. Taxes (TVA) : paramétrables plus tard, jamais codées en dur. Aucune conformité fiscale n’est revendiquée : à valider avec un comptable.</p>
      </section>
    </div>
  )
}
