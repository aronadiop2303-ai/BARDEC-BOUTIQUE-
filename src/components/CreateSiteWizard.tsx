import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Plus, Sparkles, WandSparkles, X } from 'lucide-react'
import { formatCategoryPath, type CategoryNode } from '../lib/catalog'
import type { CategoriesState } from '../lib/useCategories'

export type CreateSitePayload = {
  name: string
  /** Chemin choisi (vide = projet personnalisé, sans classification). */
  path: CategoryNode[]
}

type Props = {
  open: boolean
  categories: CategoriesState
  onClose: () => void
  onCreate: (payload: CreateSitePayload) => void
}

const LEVEL_TITLES = [
  'Quel est votre domaine d’activité ?',
  'Quel type d’activité exercez-vous ?',
  'Quelle est votre spécialité ?',
]
const LEVEL_LABELS = ['Domaine', 'Sous-domaine', 'Spécialité']
const COLORS = ['template-blue', 'template-mint', 'template-violet', 'template-sand', 'template-pink', 'template-dark']

/**
 * Parcours guidé : domaine → sous-domaine → spécialité → nom.
 * Adaptatif : l'utilisateur peut s'arrêter à n'importe quel niveau ou partir de zéro.
 * Le parcours ne crée rien en base : il renvoie le choix à l'appelant.
 */
export default function CreateSiteWizard({ open, categories, onClose, onCreate }: Props) {
  const [path, setPath] = useState<CategoryNode[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setPath([])
      setNaming(false)
      setName('')
      setError('')
    }
  }, [open])

  if (!open) return null

  const current = path.length > 0 ? path[path.length - 1] : null
  const options = current ? current.children : categories.tree
  const depth = path.length

  function choose(node: CategoryNode) {
    const next = [...path, node]
    setPath(next)
    if (node.children.length === 0) setNaming(true)
  }

  function goBack() {
    if (naming) {
      setNaming(false)
      // Sans choix possible à ce niveau (feuille), on remonte aussi d'un cran.
      if (current && current.children.length === 0) setPath(path.slice(0, -1))
      return
    }
    setPath(path.slice(0, -1))
  }

  function submit() {
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Donnez un nom à votre site pour continuer.')
      return
    }
    onCreate({ name: cleanName, path })
  }

  const canGoBack = naming || path.length > 0

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">NOUVEAU PROJET{path.length > 0 ? ` · ${formatCategoryPath(path)}` : ''}</span>
            <h2 id="create-title">{naming ? 'Comment s’appelle votre site ?' : LEVEL_TITLES[Math.min(depth, 2)]}</h2>
            <p>{naming ? 'Vous pourrez le renommer et le personnaliser ensuite.' : 'Choisissez un point de départ. Vous pourrez le modifier plus tard.'}</p>
          </div>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}><X size={19} /></button>
        </div>

        {!naming && categories.status === 'loading' && <p role="status">Chargement du catalogue d’activités…</p>}
        {!naming && categories.status === 'unconfigured' && (
          <p role="alert">Le catalogue d’activités n’est pas connecté : renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> dans <code>.env.local</code>. Vous pouvez continuer avec un projet personnalisé.</p>
        )}
        {!naming && categories.status === 'error' && (
          <p role="alert">Le catalogue d’activités est indisponible ({categories.message}). Vous pouvez continuer avec un projet personnalisé.</p>
        )}

        {!naming && (
          <div className="template-grid">
            {options.map((node, index) => (
              <button key={node.id} className="template-option" onClick={() => choose(node)}>
                <span className={`template-icon ${COLORS[index % COLORS.length]}`}><Sparkles size={21} /></span>
                <span className="template-text"><strong>{node.name}</strong><small>{node.description ?? LEVEL_LABELS[Math.min(depth, 2)]}</small></span>
                <span className="template-check"><ArrowRight size={14} /></span>
              </button>
            ))}
            {depth === 0 && (
              <button className="template-option" onClick={() => { setPath([]); setNaming(true) }}>
                <span className="template-icon template-dark"><WandSparkles size={21} /></span>
                <span className="template-text"><strong>Personnalisé</strong><small>Commencer de zéro, sans classification.</small></span>
                <span className="template-check"><ArrowRight size={14} /></span>
              </button>
            )}
            {depth > 0 && current && current.children.length > 0 && (
              <button className="template-option selected" onClick={() => setNaming(true)}>
                <span className="template-icon template-dark"><Check size={21} /></span>
                <span className="template-text"><strong>Continuer avec « {current.name} »</strong><small>Sans préciser davantage.</small></span>
                <span className="template-check"><Check size={14} /></span>
              </button>
            )}
          </div>
        )}

        {naming && (
          <>
            <label className="field-label" htmlFor="site-name">Nom de votre site</label>
            <input
              id="site-name"
              className="name-input"
              autoFocus
              value={name}
              onChange={(event) => { setName(event.target.value); setError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
              placeholder="Ex. : Ma nouvelle activité"
              maxLength={160}
            />
            {error && <p role="alert">{error}</p>}
          </>
        )}

        <div className="modal-footnote"><Sparkles size={15} /><span>Vous commencerez en brouillon. La publication en ligne sera ajoutée après le socle de création.</span></div>
        <div className="modal-actions">
          {canGoBack
            ? <button className="secondary-button" onClick={goBack}><ArrowLeft size={16} /> Retour</button>
            : <button className="secondary-button" onClick={onClose}>Annuler</button>}
          {naming && <button className="primary-button" onClick={submit}><Plus size={17} /> Créer le brouillon</button>}
        </div>
      </section>
    </div>
  )
}
