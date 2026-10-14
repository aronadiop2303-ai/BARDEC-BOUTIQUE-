import { useState, type FormEvent, type ReactNode } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { LogIn, UserPlus } from 'lucide-react'
import { signIn, signUp } from '../lib/auth'
import type { SessionState } from '../lib/useSession'

/** Contexte transmis au Studio : mode local (sans Supabase) ou utilisateur réellement connecté. */
export type StudioMode =
  | { mode: 'local'; reason: string }
  | { mode: 'connected'; client: SupabaseClient; user: User }

type Props = {
  session: SessionState
  client: SupabaseClient | null
  /** Message si les variables sont présentes mais invalides. */
  initError?: string | null
  children: (mode: StudioMode) => ReactNode
}

const LOCAL_REASON = 'Supabase n’est pas configuré : aucune connexion, données de démonstration non enregistrées.'

export default function AuthGate({ session, client, initError, children }: Props) {
  if (!client || session.status === 'unconfigured') {
    return <>{children({ mode: 'local', reason: initError ?? LOCAL_REASON })}</>
  }
  if (session.status === 'loading') {
    return <div className="modal-backdrop"><p className="notice" role="status">Vérification de la session…</p></div>
  }
  if (session.status === 'signed-out') return <AuthForm client={client} />
  return <>{children({ mode: 'connected', client, user: session.session.user })}</>
}

function AuthForm({ client }: { client: SupabaseClient }) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setInfo('')
    if (!email.trim() || !password) {
      setError('Renseignez votre e-mail et votre mot de passe.')
      return
    }
    if (tab === 'signup' && password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    setBusy(true)
    const outcome = tab === 'signin' ? await signIn(client, email, password) : await signUp(client, email, password)
    setBusy(false)
    if (!outcome.ok) setError(outcome.message)
    else if (outcome.message) setInfo(outcome.message)
    // Une session ouverte est relayée par onAuthStateChange : AuthGate affiche alors le Studio.
  }

  function switchTab(next: 'signin' | 'signup') {
    setTab(next)
    setError('')
    setInfo('')
  }

  const isSignIn = tab === 'signin'

  return (
    <div className="modal-backdrop">
      <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">BARDEC-BOUTIQUE STUDIO</span>
            <h2 id="auth-title">{isSignIn ? 'Connexion' : 'Créer un compte'}</h2>
            <p>{isSignIn ? 'Retrouvez votre espace et vos sites.' : 'Un espace personnel est créé à votre première connexion.'}</p>
          </div>
        </div>

        <div className="template-grid" role="tablist">
          <button type="button" role="tab" aria-selected={isSignIn} className={isSignIn ? 'template-option selected' : 'template-option'} onClick={() => switchTab('signin')}>
            <span className="template-icon template-blue"><LogIn size={19} /></span>
            <span className="template-text"><strong>J’ai déjà un compte</strong><small>Se connecter</small></span>
          </button>
          <button type="button" role="tab" aria-selected={!isSignIn} className={!isSignIn ? 'template-option selected' : 'template-option'} onClick={() => switchTab('signup')}>
            <span className="template-icon template-mint"><UserPlus size={19} /></span>
            <span className="template-text"><strong>Nouveau sur BARDEC</strong><small>S’inscrire</small></span>
          </button>
        </div>

        <form onSubmit={submit} noValidate>
          <label className="field-label" htmlFor="auth-email">Adresse e-mail</label>
          <input id="auth-email" className="name-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="field-label" htmlFor="auth-password" style={{ marginTop: 14 }}>Mot de passe</label>
          <input id="auth-password" className="name-input" type="password" autoComplete={isSignIn ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} />

          {error && <p role="alert">{error}</p>}
          {info && <p className="notice" role="status">{info}</p>}

          <div className="modal-actions" style={{ marginTop: 22 }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Veuillez patienter…' : isSignIn ? 'Se connecter' : 'Créer mon compte'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
