// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CreateSiteWizard from './CreateSiteWizard'
import { buildCategoryTree, type SiteCategory } from '../lib/catalog'
import type { CategoriesState } from '../lib/useCategories'

afterEach(cleanup)

const row = (id: string, name: string, level: 1 | 2 | 3, parent_id: string | null, type: string | null = null): SiteCategory => ({
  id, name, level, parent_id, slug: id, description: null, default_site_type: type, sort_order: 0,
})

const tree = buildCategoryTree([
  row('commerce', 'Commerce', 1, null, 'store'),
  row('magasin', 'Magasin', 2, 'commerce'),
  row('quinc', 'Quincaillerie', 3, 'magasin'),
  row('education', 'Éducation', 1, null, 'school'),
])

const ready: CategoriesState = { status: 'ready', tree }

function setup(categories: CategoriesState = ready) {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(<CreateSiteWizard open categories={categories} onClose={onClose} onCreate={onCreate} />)
  return { onCreate, onClose }
}

const click = (label: RegExp | string) => fireEvent.click(screen.getByRole('button', { name: label }))

describe('CreateSiteWizard', () => {
  it('ne rend rien quand il est fermé', () => {
    const { container } = render(<CreateSiteWizard open={false} categories={ready} onClose={() => {}} onCreate={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('guide domaine → sous-domaine → spécialité → nom puis crée avec le chemin complet', () => {
    const { onCreate } = setup()
    click(/Commerce/)
    click(/Magasin/)
    click(/Quincaillerie/)
    fireEvent.change(screen.getByLabelText('Nom de votre site'), { target: { value: '  Quincaillerie Diop  ' } })
    click(/Créer le brouillon/)
    expect(onCreate).toHaveBeenCalledTimes(1)
    const payload = onCreate.mock.calls[0][0]
    expect(payload.name).toBe('Quincaillerie Diop')
    expect(payload.path.map((n: { name: string }) => n.name)).toEqual(['Commerce', 'Magasin', 'Quincaillerie'])
  })

  it('permet de s’arrêter à un niveau intermédiaire', () => {
    const { onCreate } = setup()
    click(/Commerce/)
    click(/Continuer avec/)
    fireEvent.change(screen.getByLabelText('Nom de votre site'), { target: { value: 'Ma boutique' } })
    click(/Créer le brouillon/)
    expect(onCreate.mock.calls[0][0].path.map((n: { name: string }) => n.name)).toEqual(['Commerce'])
  })

  it('permet de partir de zéro (chemin vide)', () => {
    const { onCreate } = setup()
    click(/Personnalisé/)
    fireEvent.change(screen.getByLabelText('Nom de votre site'), { target: { value: 'Projet libre' } })
    click(/Créer le brouillon/)
    expect(onCreate.mock.calls[0][0]).toMatchObject({ name: 'Projet libre', path: [] })
  })

  it('refuse un nom vide', () => {
    const { onCreate } = setup()
    click(/Personnalisé/)
    click(/Créer le brouillon/)
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Donnez un nom')
  })

  it('« Retour » depuis le nom d’une feuille revient aux choix de son parent', () => {
    setup()
    click(/Commerce/)
    click(/Magasin/)
    click(/Quincaillerie/)
    click(/Retour/)
    expect(screen.queryByRole('button', { name: /Quincaillerie/ })).not.toBeNull()
    expect(screen.queryByLabelText('Nom de votre site')).toBeNull()
  })

  it('« Retour » après « Continuer avec » revient aux sous-choix du même niveau', () => {
    setup()
    click(/Commerce/)
    click(/Continuer avec/)
    click(/Retour/)
    expect(screen.queryByRole('button', { name: /Magasin/ })).not.toBeNull()
  })

  it('annule via le bouton Annuler au premier niveau', () => {
    const { onClose } = setup()
    click('Annuler')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('signale un catalogue non configuré tout en laissant le projet personnalisé', () => {
    setup({ status: 'unconfigured', tree: [] })
    expect(screen.getByRole('alert').textContent).toContain('VITE_SUPABASE_URL')
    expect(screen.queryByRole('button', { name: /Personnalisé/ })).not.toBeNull()
  })

  it('signale une erreur de chargement sans inventer de données', () => {
    setup({ status: 'error', tree: [], message: 'réseau coupé' })
    expect(screen.getByRole('alert').textContent).toContain('réseau coupé')
    expect(screen.queryByRole('button', { name: /Commerce/ })).toBeNull()
  })
})
