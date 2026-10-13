import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load(url: string, key: string) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key)
  return import('./supabase')
}

describe('client Supabase', () => {
  it('reste null sans configuration', async () => {
    const m = await load('', '')
    expect(m.supabase).toBeNull()
    expect(m.supabaseInitError).toBeNull()
  })

  it('crée un client avec une configuration valide', async () => {
    const m = await load('https://exemple.supabase.co', 'sb_publishable_test')
    expect(m.supabase).not.toBeNull()
    expect(m.supabaseInitError).toBeNull()
  })

  it('ne plante pas avec une URL invalide et explique le problème', async () => {
    const m = await load('pas-une-url', 'sb_publishable_test')
    expect(m.supabase).toBeNull()
    expect(m.supabaseInitError).toContain('VITE_SUPABASE_URL')
  })
})
