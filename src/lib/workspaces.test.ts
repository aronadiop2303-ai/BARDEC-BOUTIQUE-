import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '../test/fakeSupabase'
import { createWorkspace, findWorkspace, getOrCreateWorkspace } from './workspaces'

const USER = 'user-1'
const existing = { id: 'ws-1', owner_id: USER, name: 'Mon espace', slug: 'mon-espace-ab12' }

describe('findWorkspace', () => {
  it('renvoie l’espace possédé en priorité', async () => {
    const fake = fakeSupabase([{ data: [existing] }])
    expect(await findWorkspace(fake.client, USER)).toEqual(existing)
    expect(fake.op(fake.queries[0], 'eq')).toEqual(['owner_id', USER])
    expect(fake.queries).toHaveLength(1)
  })

  it('se rabat sur un espace partagé, sinon null', async () => {
    const shared = { ...existing, owner_id: 'autre' }
    expect(await findWorkspace(fakeSupabase([{ data: [] }, { data: [shared] }]).client, USER)).toEqual(shared)
    expect(await findWorkspace(fakeSupabase([{ data: [] }, { data: [] }]).client, USER)).toBeNull()
  })

  it('traduit les erreurs en français', async () => {
    const fake = fakeSupabase([{ error: { code: '42501', message: 'permission denied' } }])
    await expect(findWorkspace(fake.client, USER)).rejects.toThrow('règles de sécurité')
  })
})

describe('createWorkspace', () => {
  it('crée « Mon espace » avec un slug suffixé, puis relit la ligne', async () => {
    const fake = fakeSupabase([{}, { data: existing }])
    expect(await createWorkspace(fake.client, USER)).toEqual(existing)

    const [insert, read] = fake.queries
    const row = fake.op(insert, 'insert')?.[0] as Record<string, string>
    expect(row.owner_id).toBe(USER)
    expect(row.name).toBe('Mon espace')
    expect(row.slug).toMatch(/^mon-espace-[a-z0-9]{4}$/)
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    // Pas de RETURNING sur l'insertion : la ligne est relue par son identifiant.
    expect(fake.op(insert, 'select')).toBeUndefined()
    expect(fake.op(read, 'eq')).toEqual(['id', row.id])
  })

  it('réessaie avec un autre slug sur conflit 23505', async () => {
    const fake = fakeSupabase([
      { error: { code: '23505', message: 'duplicate key' } },
      {},
      { data: existing },
    ])
    await createWorkspace(fake.client, USER)
    const first = fake.op(fake.queries[0], 'insert')?.[0] as { slug: string }
    const second = fake.op(fake.queries[1], 'insert')?.[0] as { slug: string }
    expect(first.slug).not.toBe(second.slug)
  })

  it('abandonne après plusieurs conflits avec un message clair', async () => {
    const conflict = { error: { code: '23505', message: 'duplicate key' } }
    const fake = fakeSupabase([conflict, conflict, conflict, conflict, conflict])
    await expect(createWorkspace(fake.client, USER)).rejects.toThrow('Impossible de créer votre espace')
  })
})

describe('getOrCreateWorkspace', () => {
  it('ne crée qu’un seul espace pour deux appels simultanés', async () => {
    const fake = fakeSupabase([{ data: [] }, { data: [] }, {}, { data: existing }])
    const [a, b] = await Promise.all([getOrCreateWorkspace(fake.client, USER), getOrCreateWorkspace(fake.client, USER)])
    expect(a).toBe(b)
    expect(fake.queries.filter((q) => fake.op(q, 'insert'))).toHaveLength(1)
  })
})
