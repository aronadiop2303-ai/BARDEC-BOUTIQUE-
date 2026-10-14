// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('App sans configuration Supabase', () => {
  it('affiche le mode local avec les sites de démonstration, sans connexion simulée', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.getByRole('status').textContent).toContain('Mode local')
    expect(screen.queryByLabelText('Mot de passe')).toBeNull()
    expect(screen.queryByText('Connecté')).toBeNull()
    expect(screen.getByText('Ma boutique', { selector: 'h3' })).toBeTruthy()
    const publish = screen.getAllByRole('button', { name: 'Publier' })
    expect(publish.length).toBeGreaterThan(0)
    expect(publish.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })
})
