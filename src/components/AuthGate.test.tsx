// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import AuthGate, { type StudioMode } from './AuthGate'
import { CONFIRMATION_PENDING_MESSAGE } from '../lib/auth'

afterEach(cleanup)

function fakeAuthClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
      ...overrides,
    },
  } as unknown as SupabaseClient
}

const describeMode = (mode: StudioMode) =>
  <p>{mode.mode === 'local' ? `local: ${mode.reason}` : `connecté: ${mode.user.email}`}</p>

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
}

describe('AuthGate', () => {
  it('affiche explicitement le mode local sans Supabase, sans formulaire de connexion', () => {
    render(<AuthGate session={{ status: 'unconfigured' }} client={null}>{describeMode}</AuthGate>)
    expect(screen.getByText(/^local: Supabase n’est pas configuré/)).toBeTruthy()
    expect(screen.queryByLabelText('Mot de passe')).toBeNull()
  })

  it('transmet l’erreur de configuration en mode local', () => {
    render(<AuthGate session={{ status: 'unconfigured' }} client={null} initError="URL invalide">{describeMode}</AuthGate>)
    expect(screen.getByText('local: URL invalide')).toBeTruthy()
  })

  it('indique la vérification de session pendant le chargement', () => {
    render(<AuthGate session={{ status: 'loading' }} client={fakeAuthClient()}>{describeMode}</AuthGate>)
    expect(screen.getByRole('status').textContent).toContain('Vérification de la session')
  })

  it('affiche le Studio pour un utilisateur connecté', () => {
    const session = { user: { id: 'u1', email: 'arona@exemple.sn' } } as Session
    render(<AuthGate session={{ status: 'signed-in', session }} client={fakeAuthClient()}>{describeMode}</AuthGate>)
    expect(screen.getByText('connecté: arona@exemple.sn')).toBeTruthy()
  })

  it('affiche le formulaire de connexion sans session et traduit les erreurs', async () => {
    const client = fakeAuthClient({
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
      }),
    })
    render(<AuthGate session={{ status: 'signed-out' }} client={client}>{describeMode}</AuthGate>)
    expect(screen.queryByText(/^connecté/)).toBeNull()

    fill('arona@exemple.sn', 'secret123')
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou mot de passe incorrect.')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'arona@exemple.sn', password: 'secret123' })
  })

  it('prévient quand l’inscription attend une confirmation par e-mail', async () => {
    const client = fakeAuthClient()
    render(<AuthGate session={{ status: 'signed-out' }} client={client}>{describeMode}</AuthGate>)
    fireEvent.click(screen.getByRole('tab', { name: /Nouveau sur BARDEC/ }))
    fill('nouveau@exemple.sn', 'motdepasse-solide')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect((await screen.findByRole('status')).textContent).toBe(CONFIRMATION_PENDING_MESSAGE)
    expect(client.auth.signUp).toHaveBeenCalledTimes(1)
  })

  it('refuse un mot de passe trop court à l’inscription sans appeler Supabase', () => {
    const client = fakeAuthClient()
    render(<AuthGate session={{ status: 'signed-out' }} client={client}>{describeMode}</AuthGate>)
    fireEvent.click(screen.getByRole('tab', { name: /Nouveau sur BARDEC/ }))
    fill('nouveau@exemple.sn', 'court')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(screen.getByRole('alert').textContent).toContain('au moins 8 caractères')
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })
})
