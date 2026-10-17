// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { boutiquePath, parseRoute } from '../../lib/router'
import BoutiquePage from './BoutiquePage'
import ProductForm from './ProductForm'
import { permissionsFor } from '../../lib/store/permissions'
import type { BoutiqueContext } from './context'

// Parcours asynchrones en plusieurs étapes : 1 s par défaut peut ne pas suffire sur une machine chargée.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const SITE = '11111111-1111-4111-8111-111111111111'
const hardwareSite = { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'cat-q' }
const ownedBy = (owner: string) => ({ data: { id: 'ws', name: 'Mon espace', owner_id: owner } })
const quincaillerie = { data: { slug: 'quincaillerie' } }
const notConfigured: FakeResult[] = [{ data: null }, { data: [] }, { data: null }, { data: [] }]
const configured: FakeResult[] = [
  { data: { public_name: 'Quincaillerie Diop', opening_hours: {} } },
  { data: [{ module_key: 'hardware_building', is_enabled: true }] },
  { data: { id: 'doc' } },
  { data: [{ id: 'loc' }] },
]
/** Rôle métier : migration team_accounts absente (repli sur l'ancien rôle) ou présente. */
const staffNotInstalled: FakeResult = { error: { code: 'PGRST202', message: 'Could not find the function public.current_staff_role' } }
const staffRole = (role: string): FakeResult => ({ data: role })
const dashboard: FakeResult[] = [{ data: [], count: 3 }, { data: [], count: 1 }, { data: [] }, { data: [] }, { count: 0 }]

function renderPage(responses: FakeResult[], userId = 'owner') {
  const fake = fakeSupabase(responses)
  render(<BoutiquePage client={fake.client} userId={userId} siteId={SITE} section="tableau-de-bord" itemId={null} />)
  return fake
}

describe('routeur', () => {
  it('lit les routes de l’espace de gestion', () => {
    expect(parseRoute('#/boutique/abc/produits/xyz')).toEqual({ name: 'boutique', siteId: 'abc', section: 'produits', itemId: 'xyz' })
    expect(parseRoute('#/boutique/abc')).toEqual({ name: 'boutique', siteId: 'abc', section: 'tableau-de-bord', itemId: null })
    expect(parseRoute('#/boutique/abc/inconnu')).toMatchObject({ section: 'tableau-de-bord' })
    expect(parseRoute('#/site/abc')).toEqual({ name: 'site', siteId: 'abc' })
    expect(parseRoute('')).toEqual({ name: 'home' })
    expect(boutiquePath('abc', 'produits', 'nouveau')).toBe('#/boutique/abc/produits/nouveau')
  })
})

describe('garde d’accès de l’espace de gestion', () => {
  it('refuse un membre dont l’accès est désactivé (rôle métier nul)', async () => {
    renderPage([{ data: hardwareSite }, ownedBy('autre'), { data: { role: 'viewer' } }, quincaillerie, { data: null }], 'ancien')
    expect(await screen.findByText('Accès désactivé.')).toBeTruthy()
    expect(screen.queryByText('Tableau de bord')).toBeNull()
  })

  it('refuse un utilisateur qui n’est pas membre de l’espace', async () => {
    renderPage([{ data: { ...hardwareSite, status: 'published' } }, { data: null }], 'intrus')
    expect(await screen.findByText('Vous n’êtes ni propriétaire ni membre de l’espace de ce site.')).toBeTruthy()
    expect(screen.queryByText('Tableau de bord')).toBeNull()
  })

  it('garde un écran « Site » simple pour un site qui n’est pas une quincaillerie', async () => {
    renderPage([{ data: { ...hardwareSite, category_id: null, name: 'École Excellence' } }, ownedBy('owner'), { data: [] }, staffNotInstalled])
    expect(await screen.findByText(/L’éditeur de site sera la prochaine fonctionnalité/)).toBeTruthy()
  })

  it('n’affiche pas l’assistant à un membre en lecture seule', async () => {
    renderPage([{ data: hardwareSite }, ownedBy('autre'), { data: { role: 'viewer' } }, quincaillerie, staffRole('viewer'), ...notConfigured], 'lecteur')
    expect(await screen.findByText('Cette boutique n’est pas encore configurée.')).toBeTruthy()
    expect(screen.queryByText('Votre boutique')).toBeNull()
  })

  it('affiche le menu, les sections « bientôt » inactives et le rôle', async () => {
    renderPage([{ data: hardwareSite }, ownedBy('autre'), { data: { role: 'editor' } }, quincaillerie, staffNotInstalled, ...configured, ...dashboard], 'vendeur')
    expect(await screen.findByRole('heading', { name: 'Tableau de bord' })).toBeTruthy()
    for (const label of ['Produits', 'Familles', 'Stock', 'Ventes et caisse']) expect(screen.getByRole('link', { name: label })).toBeTruthy()
    // Un vendeur n'a ni Paramètres ni Équipe dans son menu.
    expect(screen.queryByRole('link', { name: 'Paramètres boutique' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Équipe' })).toBeNull()
    const soon = screen.getByText('Devis et documents').closest('[aria-disabled]')
    expect(soon?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Vendeur / Comptoir')).toBeTruthy()
    // Matrice : un vendeur ne crée pas de produit.
    expect(screen.queryByRole('link', { name: /Nouveau produit/ })).toBeNull()
    await waitFor(() => expect(screen.getByText('Produits actifs')).toBeTruthy())
    expect(screen.getByText('1 en brouillon')).toBeTruthy()
  })
})

describe('assistant de configuration', () => {
  it('guide en 3 étapes puis écrit la configuration une seule fois', async () => {
    const fake = renderPage([
      { data: hardwareSite }, ownedBy('owner'), quincaillerie, staffRole('owner'), ...notConfigured,
      // runSetup : emplacements existants, profil, emplacements, familles, unités, module, réglages
      { data: [] }, {}, {}, {}, {}, {}, {},
      // rechargement : boutique configurée, puis tableau de bord
      ...configured, ...dashboard,
    ])
    expect(await screen.findByRole('heading', { name: 'Votre boutique' })).toBeTruthy()
    expect((screen.getByLabelText('Nom public de la boutique *') as HTMLInputElement).value).toBe('Quincaillerie Diop')

    fireEvent.change(screen.getByLabelText('Nom public de la boutique *'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(screen.getByRole('alert').textContent).toContain('obligatoire')

    fireEvent.change(screen.getByLabelText('Nom public de la boutique *'), { target: { value: 'Quincaillerie Diop' } })
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(screen.getByRole('heading', { name: 'Emplacements de stock' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(screen.getByRole('heading', { name: 'Familles et unités' })).toBeTruthy()
    expect(fake.queries.some((q) => q.ops.some(([name]) => ['insert', 'upsert'].includes(name)))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Terminer la configuration' }))
    expect(await screen.findByRole('heading', { name: 'Tableau de bord' })).toBeTruthy()
    const writes = fake.queries.filter((q) => q.ops.some(([name]) => ['insert', 'upsert'].includes(name))).map((q) => q.table)
    expect(writes).toEqual(['business_profiles', 'stock_locations', 'product_categories', 'product_units', 'site_commerce_modules', 'store_document_settings'])
  })
})

describe('fiche produit', () => {
  const ctxFor = (role: 'owner' | 'editor', responses: FakeResult[]) => {
    const fake = fakeSupabase(responses)
    const ctx: BoutiqueContext = {
      client: fake.client, userId: 'u', siteId: SITE,
      access: { site: hardwareSite, workspace: { id: 'ws', name: 'Espace', owner_id: 'u' }, role, isHardware: true },
      can: permissionsFor(role),
    }
    return { fake, ctx }
  }
  const product = {
    id: 'p1', category_id: null, name: 'Câble 2,5 mm²', slug: 'cable', status: 'active', price: 350, currency_code: 'XOF',
    sku: 'CAB-25', barcode: null, track_inventory: true, updated_at: '2026-10-15', description: null, attributes: { brand: 'Nexans' },
  }
  const detail: FakeResult[] = [
    { data: product },
    { data: [{ id: 'su', unit_id: 'm', conversion_to_base: 1, is_default: true, min_sale_quantity: 1, quantity_step: 0.5 }] },
    { data: [] }, { data: [] }, { data: [] },
  ]
  const unitsAndFamilies: FakeResult[] = [{ data: [{ id: 'm', code: 'm', label: 'Mètre', dimension: 'length', decimal_places: 2 }] }, { data: [] }]

  it('est en consultation seule pour un vendeur (matrice cible)', async () => {
    // Promise.all : produit puis unités et familles, ensuite les lignes liées du produit.
    const { ctx } = ctxFor('editor', [detail[0], ...unitsAndFamilies, ...detail.slice(1)])
    render(<ProductForm ctx={ctx} productId="p1" />)
    expect(await screen.findByText(/Consultation seule/)).toBeTruthy()
    expect((screen.getByLabelText('Nom *') as HTMLInputElement).value).toBe('Câble 2,5 mm²')
    expect((screen.getByLabelText('Nom *').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Archiver/ })).toBeNull()
  })

  it('n’estime jamais de marge sans prix d’achat', async () => {
    const { ctx } = ctxFor('owner', [detail[0], ...unitsAndFamilies, ...detail.slice(1)])
    render(<ProductForm ctx={ctx} productId="p1" />)
    expect(await screen.findByText(/Aucune marge n’est estimée/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Archiver/ })).toBeTruthy()
    expect(screen.getByLabelText('Aperçu des prix').textContent).toContain('1 et plus → 350 FCFA')
  })

  it('refuse l’enregistrement sans unité de base, sans appel à la base', async () => {
    const { ctx, fake } = ctxFor('owner', unitsAndFamilies)
    render(<ProductForm ctx={ctx} productId={null} />)
    fireEvent.change(await screen.findByLabelText('Nom *'), { target: { value: 'Ciment' } })
    fireEvent.change(screen.getByLabelText(/Prix de vente par/), { target: { value: '5000' } })
    const before = fake.queries.length
    fireEvent.click(screen.getByRole('button', { name: 'Créer le produit' }))
    expect((await screen.findByRole('alert')).textContent).toContain('unité de vente')
    expect(fake.queries.length).toBe(before)
  })
})
