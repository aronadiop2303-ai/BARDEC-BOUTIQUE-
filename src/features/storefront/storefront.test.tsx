// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { parseRoute, storefrontPath } from '../../lib/router'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from '../boutique/context'
import PublicSitePage from '../boutique/PublicSitePage'
import StorefrontPage from './StorefrontPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'
const shop = { id: SITE, name: 'Quincaillerie Diop', phone: '33 820 00 00', whatsapp: '77 123 45 67', email: null, address: 'Route de Rufisque', city: 'Pikine', opening_hours: 'Lun-Sam 8h-19h', currency: 'XOF', published: true }
const categories: FakeResult = { data: [{ id: 'cat-1', parent_id: null, name: 'Électricité', slug: 'electricite', product_count: 2 }] }
const products: FakeResult = {
  data: [
    { id: 'p1', slug: 'cable', name: 'Câble 2,5 mm²', category_id: 'cat-1', price: 400, currency_code: 'XOF', image_url: null, unit_label: 'Mètre', availability: 'in_stock' },
    { id: 'p2', slug: 'disjoncteur', name: 'Disjoncteur 16 A', category_id: 'cat-1', price: 3500, currency_code: 'XOF', image_url: 'https://img.test/d.jpg', unit_label: 'Pièce', availability: 'out_of_stock' },
  ],
}

function show(view: 'home' | 'category' | 'product', param: string | null, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  render(<StorefrontPage client={fake.client} siteId={SITE} view={view} param={param} />)
  return fake
}

describe('routage de la vitrine', () => {
  it('lit les adresses publiques', () => {
    expect(parseRoute(`#/vitrine/${SITE}`)).toEqual({ name: 'storefront', siteId: SITE, view: 'home', param: null })
    expect(parseRoute(`#/vitrine/${SITE}/famille/cat-1`)).toEqual({ name: 'storefront', siteId: SITE, view: 'category', param: 'cat-1' })
    expect(parseRoute(`#/vitrine/${SITE}/produit/cable`)).toEqual({ name: 'storefront', siteId: SITE, view: 'product', param: 'cable' })
    expect(storefrontPath(SITE, 'product', 'câble')).toBe(`#/vitrine/${SITE}/produit/c%C3%A2ble`)
  })
})

describe('vitrine publique', () => {
  it('site non publié : rien n’est affiché', async () => {
    show('home', null, [{ data: null }, { data: [] }])
    expect(await screen.findByText('Cette boutique n’est pas en ligne.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull()
  })

  it('catalogue : nom, prix, disponibilité sans quantité, coordonnées, WhatsApp', async () => {
    const fake = show('home', null, [{ data: shop }, categories, products])
    const grid = await screen.findByRole('list')
    expect(within(grid).getByText('Câble 2,5 mm²')).toBeTruthy()
    expect(within(grid).getByText('En stock')).toBeTruthy()
    expect(within(grid).getByText('Rupture de stock')).toBeTruthy()
    expect(screen.getByLabelText('Pas de photo pour Câble 2,5 mm²')).toBeTruthy()
    expect(screen.getByRole('contentinfo').textContent).toContain('Route de Rufisque, Pikine')
    const whatsapp = screen.getByRole('link', { name: /Commander sur WhatsApp/ }) as HTMLAnchorElement
    expect(whatsapp.href).toMatch(/^https:\/\/wa\.me\/221771234567\?text=/)
    expect(screen.getByRole('link', { name: /Électricité/ })).toBeTruthy()
    // Lecture uniquement par les fonctions publiques, jamais de table brute.
    expect(fake.queries.map((q) => q.table)).toEqual(['rpc:storefront_shop', 'rpc:storefront_categories', 'rpc:storefront_products'])
    expect(screen.queryByText(/achat|marge/i)).toBeNull()
  })

  it('famille : filtre transmis à la base ; recherche', async () => {
    const fake = show('category', 'cat-1', [{ data: shop }, categories, products, { data: [] }])
    await screen.findByRole('heading', { name: 'Électricité' })
    const first = fake.queries.find((q) => q.table === 'rpc:storefront_products')!
    expect(fake.op(first, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_category_id: 'cat-1', p_search: null, p_limit: 24, p_offset: 0 })
    fireEvent.change(screen.getByLabelText('Rechercher un produit'), { target: { value: 'câble' } })
    expect(await screen.findByText('Aucun produit à afficher.')).toBeTruthy()
    const last = fake.queries.filter((q) => q.table === 'rpc:storefront_products').slice(-1)[0]
    expect(fake.op(last, 'rpc')?.[0]).toMatchObject({ p_search: 'câble' })
  })

  it('fiche produit : prix, unité, disponibilité, commande WhatsApp pré-remplie', async () => {
    show('product', 'cable', [{ data: shop }, categories, {
      data: { ...(products.data as Record<string, unknown>[])[0], category_name: 'Électricité', description: 'Câble rigide H07V-U', attributes: { Marque: 'Nexans' } },
    }])
    const article = await screen.findByRole('article', { name: 'Câble 2,5 mm²' })
    expect(article.textContent).toContain('400 FCFA / Mètre')
    expect(article.textContent).toContain('Nexans')
    const link = within(article).getByRole('link', { name: /Commander sur WhatsApp/ }) as HTMLAnchorElement
    expect(decodeURIComponent(link.href)).toContain('je souhaite commander : Câble 2,5 mm² (400 FCFA / Mètre)')
    expect(article.textContent).toContain('aucun paiement en ligne')
  })

  it('aperçu non publié signalé', async () => {
    show('home', null, [{ data: { ...shop, published: false } }, categories, products])
    expect(await screen.findByText(/Aperçu : cette boutique n’est pas publiée/)).toBeTruthy()
  })
})

function manage(role: EffectiveRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'u-1' }, role: role === 'owner' ? 'owner' : 'admin', isHardware: true },
    can: permissionsFor(role),
    staffRole: role,
  }
  render(<PublicSitePage ctx={ctx} />)
  return fake
}

describe('publication', () => {
  it('gérant : aperçu, mais pas de bouton Publier', async () => {
    manage('manager', [{ data: { ...shop, published: false } }])
    expect(await screen.findByText('Seul le propriétaire peut publier ou dépublier la boutique.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publier' })).toBeNull()
    expect(screen.getByRole('link', { name: /Aperçu/ })).toBeTruthy()
  })

  it('propriétaire : confirmation explicite (aperçu vérifié + nom exact) avant publication', async () => {
    const fake = manage('owner', [{ data: { ...shop, published: false } }, { data: { status: 'published', changed: true } }, { data: shop }])
    fireEvent.click(await screen.findByRole('button', { name: 'Publier' }))
    const confirm = screen.getByRole('button', { name: 'Confirmer la publication' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Nom de la boutique pour confirmer'), { target: { value: 'Quincaillerie Diop' } })
    expect(confirm.disabled).toBe(true)
    expect(fake.queries.some((q) => q.table === 'rpc:set_storefront_published')).toBe(false)
    fireEvent.click(screen.getByLabelText(/J’ai vérifié l’aperçu/))
    fireEvent.click(confirm)
    expect(await screen.findByText('Boutique publiée : elle est visible sur internet.')).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:set_storefront_published')!
    expect(fake.op(call, 'rpc')?.[0]).toEqual({ p_site_id: SITE, p_publish: true, p_confirm_name: 'Quincaillerie Diop' })
  })

  it('propriétaire : dépublication possible', async () => {
    const fake = manage('owner', [{ data: shop }, { data: { status: 'draft', changed: true } }, { data: null }])
    fireEvent.click(await screen.findByRole('button', { name: 'Dépublier' }))
    fireEvent.change(screen.getByLabelText('Nom de la boutique pour confirmer'), { target: { value: 'Quincaillerie Diop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la dépublication' }))
    expect(await screen.findByText(/Boutique dépubliée/)).toBeTruthy()
    expect(fake.op(fake.queries.find((q) => q.table === 'rpc:set_storefront_published')!, 'rpc')?.[0]).toMatchObject({ p_publish: false })
  })
})
