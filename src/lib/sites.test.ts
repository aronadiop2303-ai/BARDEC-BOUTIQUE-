import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '../test/fakeSupabase'
import { createSite, listSites } from './sites'

const saved = {
  id: 'site-1', workspace_id: 'ws-1', name: 'Quincaillerie Diop', slug: 'quincaillerie-diop',
  site_type: 'store', status: 'draft', category_id: 'quinc', template_id: null, published_at: null,
  created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:00:00Z',
}

const insertedRow = (fake: ReturnType<typeof fakeSupabase>, index = 0) =>
  fake.op(fake.queries[index], 'insert')?.[0] as Record<string, unknown>

describe('createSite', () => {
  it('enregistre toujours un brouillon, jamais une publication', async () => {
    const fake = fakeSupabase([{ data: saved }])
    const site = await createSite(fake.client, {
      workspaceId: 'ws-1', name: '  Quincaillerie Diop ', categoryId: 'quinc', siteType: 'store',
    })
    expect(site).toEqual(saved)
    const row = insertedRow(fake)
    expect(fake.queries[0].table).toBe('sites')
    expect(row).toEqual({
      workspace_id: 'ws-1', name: 'Quincaillerie Diop', slug: 'quincaillerie-diop',
      status: 'draft', site_type: 'store', category_id: 'quinc', template_id: null,
    })
    expect(row).not.toHaveProperty('published_at')
  })

  it('accepte un projet « Personnalisé » (catégorie nulle)', async () => {
    const fake = fakeSupabase([{ data: saved }])
    await createSite(fake.client, { workspaceId: 'ws-1', name: 'Mon projet', categoryId: null, siteType: 'business' })
    expect(insertedRow(fake).category_id).toBeNull()
  })

  it('remplace un type de site inconnu par « business »', async () => {
    const fake = fakeSupabase([{ data: saved }])
    await createSite(fake.client, { workspaceId: 'ws-1', name: 'X', categoryId: null, siteType: 'inconnu' })
    expect(insertedRow(fake).site_type).toBe('business')
  })

  it('ajoute un suffixe au slug en cas de conflit 23505', async () => {
    const fake = fakeSupabase([{ error: { code: '23505', message: 'duplicate key' } }, { data: saved }])
    await createSite(fake.client, { workspaceId: 'ws-1', name: 'Quincaillerie Diop', categoryId: null, siteType: 'store' })
    expect(insertedRow(fake, 0).slug).toBe('quincaillerie-diop')
    expect(insertedRow(fake, 1).slug).toMatch(/^quincaillerie-diop-[a-z0-9]{4}$/)
    expect(insertedRow(fake, 1).status).toBe('draft')
  })

  it('refuse un nom vide sans appeler la base', async () => {
    const fake = fakeSupabase([])
    await expect(createSite(fake.client, { workspaceId: 'ws-1', name: '   ', categoryId: null, siteType: 'store' }))
      .rejects.toThrow('obligatoire')
    expect(fake.queries).toHaveLength(0)
  })

  it('remonte un refus RLS en français', async () => {
    const fake = fakeSupabase([{ error: { code: '42501', message: 'new row violates row-level security policy' } }])
    await expect(createSite(fake.client, { workspaceId: 'ws-1', name: 'X', categoryId: null, siteType: 'store' }))
      .rejects.toThrow('règles de sécurité')
  })
})

describe('listSites', () => {
  it('lit les sites de l’espace, du plus récent au plus ancien', async () => {
    const fake = fakeSupabase([{ data: [saved] }])
    expect(await listSites(fake.client, 'ws-1')).toEqual([saved])
    expect(fake.op(fake.queries[0], 'eq')).toEqual(['workspace_id', 'ws-1'])
    expect(fake.op(fake.queries[0], 'order')).toEqual(['updated_at', { ascending: false }])
    expect(fake.queries.some((q) => fake.op(q, 'update') || fake.op(q, 'insert'))).toBe(false)
  })
})
