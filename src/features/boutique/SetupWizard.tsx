import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { STARTER_FAMILIES, STARTER_LOCATIONS, STARTER_UNITS } from '../../domain/hardware/starter'
import { runSetup, validateProfile, type ProfileInput, type SetupStatus } from '../../lib/store/setup'
import type { BoutiqueContext } from './context'
import ProfileFields from './ProfileFields'

const STEPS = ['Votre boutique', 'Emplacements de stock', 'Familles et unités']

function profileFrom(status: SetupStatus, siteName: string): ProfileInput {
  const p = status.profile
  return {
    public_name: p?.public_name ?? siteName,
    phone: p?.phone ?? '',
    whatsapp: p?.whatsapp ?? '',
    address: p?.address ?? '',
    city: p?.city ?? '',
    hours: p?.opening_hours?.text ?? '',
  }
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function CheckList({ legend, items, selected, onToggle }: {
  legend: string
  items: { key: string; label: string; hint?: string }[]
  selected: string[]
  onToggle: (key: string) => void
}) {
  return (
    <fieldset className="bq-checklist">
      <legend className="field-label">{legend}</legend>
      {items.map((item) => (
        <label key={item.key} className={selected.includes(item.key) ? 'bq-check selected' : 'bq-check'}>
          <input type="checkbox" checked={selected.includes(item.key)} onChange={() => onToggle(item.key)} />
          <span><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Configuration initiale en 3 étapes. Rien n'est écrit avant la validation finale ;
 * l'écriture est idempotente (relancer ne crée pas de doublons).
 */
export default function SetupWizard({ ctx, status, onDone }: { ctx: BoutiqueContext; status: SetupStatus; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState(() => profileFrom(status, ctx.access.site.name))
  const [locations, setLocations] = useState(['magasin', 'depot'])
  const [families, setFamilies] = useState(STARTER_FAMILIES.map((f) => f.slug))
  const [units, setUnits] = useState(STARTER_UNITS.map((u) => u.code))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function next() {
    setError('')
    if (step === 0) {
      const problem = validateProfile(profile)
      if (problem) { setError(problem); return }
    }
    if (step === 1 && locations.length === 0 && status.locationCount === 0) {
      setError('Choisissez au moins un emplacement de stock.')
      return
    }
    setStep(step + 1)
  }

  async function finish() {
    setError('')
    setSaving(true)
    try {
      await runSetup(ctx.client, ctx.siteId, ctx.userId, {
        profile,
        locations,
        families,
        units,
      })
      onDone()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La configuration a échoué.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bq-card bq-wizard" aria-labelledby="setup-title">
      <p className="eyebrow">CONFIGURATION · ÉTAPE {step + 1} SUR 3</p>
      <h1 id="setup-title" className="bq-title">{STEPS[step]}</h1>
      <ol className="bq-steps">
        {STEPS.map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'done' : ''}>{index < step ? <Check size={13} /> : index + 1} {label}</li>)}
      </ol>

      {step === 0 && <ProfileFields value={profile} onChange={setProfile} />}

      {step === 1 && (
        <CheckList
          legend="Où rangez-vous votre marchandise ?"
          items={STARTER_LOCATIONS.map((l) => ({ key: l.key, label: l.name }))}
          selected={locations}
          onToggle={(key) => setLocations(toggle(locations, key))}
        />
      )}

      {step === 2 && (
        <div className="bq-two-columns">
          <CheckList
            legend={`Familles de produits (${families.length})`}
            items={STARTER_FAMILIES.map((f) => ({ key: f.slug, label: f.name, hint: f.description }))}
            selected={families}
            onToggle={(key) => setFamilies(toggle(families, key))}
          />
          <CheckList
            legend={`Unités de mesure (${units.length})`}
            items={STARTER_UNITS.map((u) => ({ key: u.code, label: u.label }))}
            selected={units}
            onToggle={(key) => setUnits(toggle(units, key))}
          />
        </div>
      )}

      {error && <p role="alert" className="bq-error">{error}</p>}
      <p className="bq-hint">Tout reste modifiable ensuite. Aucun produit, aucune vente ni aucune donnée de démonstration n’est créé.</p>

      <div className="modal-actions">
        {step > 0 && <button className="secondary-button" onClick={() => { setError(''); setStep(step - 1) }} disabled={saving}><ArrowLeft size={15} /> Retour</button>}
        {step < 2
          ? <button className="primary-button" onClick={next}>Continuer <ArrowRight size={15} /></button>
          : <button className="primary-button" onClick={finish} disabled={saving}>{saving ? 'Enregistrement…' : 'Terminer la configuration'}</button>}
      </div>
    </section>
  )
}
