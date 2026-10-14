import type { ProfileInput } from '../../lib/store/setup'

/** Champs du profil public de la boutique (assistant et paramètres). */
export default function ProfileFields({ value, onChange, disabled }: { value: ProfileInput; onChange: (next: ProfileInput) => void; disabled?: boolean }) {
  const field = (key: keyof ProfileInput, label: string, props: Record<string, unknown> = {}) => (
    <div className="bq-field">
      <label className="field-label" htmlFor={`profile-${key}`}>{label}</label>
      <input
        id={`profile-${key}`}
        className="name-input"
        value={value[key]}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        {...props}
      />
    </div>
  )
  return (
    <div className="bq-form-grid">
      {field('public_name', 'Nom public de la boutique *', { maxLength: 180, autoComplete: 'organization' })}
      {field('phone', 'Téléphone', { type: 'tel', inputMode: 'tel', placeholder: '+221 77 000 00 00' })}
      {field('whatsapp', 'WhatsApp', { type: 'tel', inputMode: 'tel' })}
      {field('city', 'Ville', { placeholder: 'Dakar' })}
      {field('address', 'Adresse')}
      {field('hours', 'Horaires', { placeholder: 'Lun–Sam 8h–19h' })}
      <p className="bq-hint">Devise : <strong>XOF (FCFA)</strong>, sans décimale.</p>
    </div>
  )
}
