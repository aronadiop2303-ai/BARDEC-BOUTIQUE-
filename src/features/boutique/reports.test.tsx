// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { EffectiveRole } from '../../domain/team/roles'
import type { BoutiqueContext } from './context'
import ReportsPage, { MARGIN_NOTICE } from './ReportsPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: EffectiveRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role: 'viewer', isHardware: true },
    can: permissionsFor(role),
    staffRole: role,
  }
  render(<ReportsPage ctx={ctx} />)
  return fake
}

const sales: FakeResult = { data: [{ period: '2026-10-16', sales_count: 4, gross_total: 50000, returns_total: 5000, net_total: 45000 }] }
const top: FakeResult = { data: [{ product_id: 'p1', product_name: 'Ciment 50 kg', unit_label: 'Sac', quantity_sold: 8, quantity_returned: 1, revenue: 35000 }] }
const sellers: FakeResult = { data: [{ cashier_id: 'u-2', cashier_name: 'Awa', sales_count: 4, total: 50000 }] }
const margin: FakeResult = { data: { cost_basis: 'current_average_cost', revenue_with_cost: 40000, cost: 30000, margin: 10000, revenue_without_cost: 5000, products_without_cost: 1 } }
const restock: FakeResult = { data: [{ product_id: 'p1', product_name: 'Ciment 50 kg', sku: 'CIM', unit_label: 'Sac', stock: 3, min_quantity: 10, suggested_quantity: 20 }] }

describe('rapports et alertes', () => {
  it('propriétaire : montants de la base, marge signalée comme estimation, export CSV', async () => {
    const fake = setup('owner', [sales, top, sellers, margin])
    const table = await screen.findByRole('table', { name: 'Tableau des ventes' })
    expect(within(table).getByText('16/10/2026')).toBeTruthy()
    expect(within(table).getByText('45 000 FCFA')).toBeTruthy()
    expect(screen.getByText(MARGIN_NOTICE)).toBeTruthy()
    expect(screen.getByText('10 000 FCFA (25 %)')).toBeTruthy()
    expect(screen.getByText(/1 produit\(s\) sans prix d’achat, exclus de la marge/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Exporter CSV/ })).toHaveLength(3)
    const call = fake.queries.find((q) => q.table === 'rpc:sales_report')!
    expect(fake.op(call, 'rpc')?.[0]).toMatchObject({ p_site_id: SITE, p_granularity: 'day' })
    expect(fake.queries.map((q) => q.table)).toEqual(['rpc:sales_report', 'rpc:top_products', 'rpc:sales_by_seller', 'rpc:margin_report'])
  })

  it('regroupement par semaine transmis à la base', async () => {
    const fake = setup('manager', [sales, top, sellers, margin, { data: [{ ...(sales.data as object[])[0], period: '2026-10-12' }] }, top, sellers, margin])
    await screen.findByRole('table', { name: 'Tableau des ventes' })
    fireEvent.change(screen.getByLabelText('Regrouper par'), { target: { value: 'week' } })
    expect(await screen.findByText('Semaine du 12/10/2026')).toBeTruthy()
    expect(fake.op(fake.queries.filter((q) => q.table === 'rpc:sales_report')[1], 'rpc')?.[0]).toMatchObject({ p_granularity: 'week' })
  })

  it('magasinier : seulement « à réapprovisionner », aucun montant ni coût', async () => {
    const fake = setup('stock_keeper', [restock])
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['À réapprovisionner'])
    const table = await screen.findByRole('table', { name: 'Produits sous le seuil' })
    expect(within(table).getByText('20')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/FCFA|marge/i)
    expect(fake.queries.every((q) => q.table === 'rpc:restock_list')).toBe(true)
  })

  it('seuil de stock bas défini par set_stock_threshold', async () => {
    const fake = setup('stock_keeper', [restock, { data: [{ id: 'p1', name: 'Ciment 50 kg' }] }, {}, restock])
    await screen.findByRole('table', { name: 'Produits sous le seuil' })
    fireEvent.change(screen.getByLabelText('Produit pour le seuil'), { target: { value: 'Cim' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir' }))
    fireEvent.change(screen.getByLabelText('Seuil minimum (unité de base)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Quantité à recommander'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Seuil de « Ciment 50 kg » : 10.')).toBeTruthy()
    expect(fake.op(fake.queries.find((q) => q.table === 'rpc:set_stock_threshold')!, 'rpc')?.[0]).toEqual({ p_product_id: 'p1', p_min_quantity: 10, p_reorder_quantity: 20 })
  })
})
