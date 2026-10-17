import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Globe2, Store } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { boutiquePath, type BoutiqueSection } from '../../lib/router'
import { loadStoreAccess } from '../../lib/store/access'
import { permissionsFor } from '../../lib/store/permissions'
import { getStaffRole } from '../../lib/store/team'
import { legacyToEffective } from '../../domain/team/roles'
import { getSetupStatus } from '../../lib/store/setup'
import { useAsync } from '../../lib/useAsync'
import BoutiqueLayout from './BoutiqueLayout'
import type { BoutiqueContext } from './context'
import SetupWizard from './SetupWizard'

type Props = {
  client: SupabaseClient
  userId: string
  siteId: string
  section: BoutiqueSection
  itemId: string | null
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bq-page">
      <header className="bq-topbar">
        <a className="text-button" href="#/"><ArrowLeft size={15} /> Retour au Studio</a>
        <strong>{title}</strong>
      </header>
      <main className="bq-main">{children}</main>
    </div>
  )
}

/**
 * Garde d'accès : l'espace de gestion ne s'affiche qu'au propriétaire ou à un membre de l'espace du site.
 * L'interface masque ; la protection réelle reste la RLS de chaque table.
 */
export default function BoutiquePage({ client, userId, siteId, section, itemId }: Props) {
  const access = useAsync(async () => {
    const result = await loadStoreAccess(client, siteId, userId)
    if (result.status !== 'ok') return { result, staffRole: null }
    // Rôle métier lu par la base ; sans la migration team_accounts, traduction de l'ancien rôle de membre.
    const staff = await getStaffRole(client, siteId)
    return { result, staffRole: staff === 'not-installed' ? legacyToEffective(result.access.role) : staff }
  }, [client, siteId, userId])

  if (access.status === 'loading') return <Shell title="Espace de gestion"><Loading label="Vérification de vos droits…" /></Shell>
  if (access.status === 'error') return <Shell title="Espace de gestion"><ErrorPanel message={access.message} onRetry={access.reload} /></Shell>
  const { result, staffRole } = access.data
  if (result.status === 'not-found') {
    return <Shell title="Site introuvable"><div className="empty-state" role="alert"><strong>Ce site n’existe pas ou vous n’y avez pas accès.</strong></div></Shell>
  }
  if (result.status === 'forbidden' || !staffRole) {
    return (
      <Shell title="Accès refusé">
        <div className="empty-state" role="alert">
          <strong>{result.status === 'forbidden' ? 'Vous n’êtes ni propriétaire ni membre de l’espace de ce site.' : 'Accès désactivé.'}</strong>
          <span>{result.status === 'forbidden' ? 'Demandez au propriétaire de vous inviter dans son espace.' : 'Votre accès à cette boutique est désactivé. Contactez le propriétaire ou le gérant.'}</span>
        </div>
      </Shell>
    )
  }

  const storeAccess = result.access
  if (!storeAccess.isHardware) {
    return (
      <Shell title={storeAccess.site.name}>
        <div className="empty-state">
          <Globe2 size={22} />
          <strong>{storeAccess.site.name}</strong>
          <span>L’éditeur de site sera la prochaine fonctionnalité construite. L’espace de gestion est réservé aux quincailleries pour l’instant.</span>
        </div>
      </Shell>
    )
  }

  const ctx: BoutiqueContext = { client, userId, siteId, access: storeAccess, can: permissionsFor(staffRole), staffRole }
  return <ConfiguredBoutique ctx={ctx} section={section} itemId={itemId} />
}

function ConfiguredBoutique({ ctx, section, itemId }: { ctx: BoutiqueContext; section: BoutiqueSection; itemId: string | null }) {
  const setup = useAsync(() => getSetupStatus(ctx.client, ctx.siteId), [ctx.client, ctx.siteId])
  const title = ctx.access.site.name

  if (setup.status === 'loading') return <Shell title={title}><Loading label="Chargement de la boutique…" /></Shell>
  if (setup.status === 'error') return <Shell title={title}><ErrorPanel message={setup.message} onRetry={setup.reload} /></Shell>

  if (!setup.data.complete) {
    if (!ctx.can.configure) {
      return (
        <Shell title={title}>
          <div className="empty-state">
            <Store size={22} />
            <strong>Cette boutique n’est pas encore configurée.</strong>
            <span>Seul le propriétaire ou un gérant (admin) peut lancer la configuration.</span>
          </div>
        </Shell>
      )
    }
    return (
      <Shell title={title}>
        <SetupWizard ctx={ctx} status={setup.data} onDone={() => { setup.reload(); window.location.hash = boutiquePath(ctx.siteId) }} />
      </Shell>
    )
  }

  return <BoutiqueLayout ctx={ctx} section={section} itemId={itemId} />
}
