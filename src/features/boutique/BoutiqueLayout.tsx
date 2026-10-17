import { ArrowLeft, Boxes, ClipboardList, FileText, FolderTree, LayoutDashboard, Package, Receipt, Settings2, Truck, Users, UsersRound, BarChart3, Globe2 } from 'lucide-react'
import { legacyToEffective, STAFF_ROLE_LABELS } from '../../domain/team/roles'
import type { StorePermissions } from '../../lib/store/permissions'
import { boutiquePath, type BoutiqueSection } from '../../lib/router'
import type { BoutiqueContext } from './context'
import Dashboard from './Dashboard'
import DeliveriesPage from './DeliveriesPage'
import FamiliesPage from './FamiliesPage'
import ImportPage from './ImportPage'
import PosPage from './PosPage'
import ProductForm from './ProductForm'
import ProductsPage from './ProductsPage'
import PublicSitePage from './PublicSitePage'
import SettingsPage from './SettingsPage'
import StockPage from './StockPage'
import TeamPage from './TeamPage'

const catalogReader = (can: StorePermissions) => can.viewStock || can.accessPos || can.editCatalog

/** Sections et rôle requis : l'interface masque, la base protège (RLS et fonctions). */
const MENU: { section: BoutiqueSection; label: string; icon: typeof Package; allowed: (can: StorePermissions) => boolean }[] = [
  { section: 'tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard, allowed: () => true },
  { section: 'produits', label: 'Produits', icon: Package, allowed: catalogReader },
  { section: 'familles', label: 'Familles', icon: FolderTree, allowed: catalogReader },
  { section: 'stock', label: 'Stock', icon: Boxes, allowed: (can) => can.viewStock },
  { section: 'ventes', label: 'Ventes et caisse', icon: Receipt, allowed: (can) => can.accessPos },
  { section: 'livraisons', label: 'Mes livraisons', icon: Truck, allowed: (can) => can.deliveries || can.manageTeam },
  { section: 'equipe', label: 'Équipe', icon: UsersRound, allowed: (can) => can.manageTeam },
  { section: 'site-public', label: 'Boutique en ligne', icon: Globe2, allowed: (can) => can.previewStorefront },
  { section: 'parametres', label: 'Paramètres boutique', icon: Settings2, allowed: (can) => can.configure },
]

/** Sections prévues, visibles mais inactives : aucun faux contenu. */
const SOON: { label: string; milestone: string; icon: typeof Package }[] = [
  { label: 'Clients et crédits', milestone: 'Q4', icon: Users },
  { label: 'Fournisseurs et achats', milestone: 'Q4', icon: Truck },
  { label: 'Devis et documents', milestone: 'Q5', icon: FileText },
  { label: 'Rapports', milestone: 'Q6', icon: BarChart3 },
  { label: 'Journal d’audit', milestone: 'Q6', icon: ClipboardList },
]

export default function BoutiqueLayout({ ctx, section, itemId }: { ctx: BoutiqueContext; section: BoutiqueSection; itemId: string | null }) {
  const menu = MENU.filter((item) => item.allowed(ctx.can))
  const current = MENU.find((item) => item.section === section) ?? MENU[0]
  const staffRole = ctx.staffRole ?? legacyToEffective(ctx.access.role)

  let content
  if (!current.allowed(ctx.can)) content = <p className="bq-error" role="alert">Cette section n’est pas accessible avec votre rôle ({STAFF_ROLE_LABELS[staffRole]}).</p>
  else if (section === 'produits' && itemId === 'import') content = <ImportPage ctx={ctx} />
  else if (section === 'produits' && itemId) content = <ProductForm ctx={ctx} productId={itemId === 'nouveau' ? null : itemId} />
  else if (section === 'produits') content = <ProductsPage ctx={ctx} />
  else if (section === 'familles') content = <FamiliesPage ctx={ctx} />
  else if (section === 'stock') content = <StockPage ctx={ctx} />
  else if (section === 'ventes') content = <PosPage ctx={ctx} />
  else if (section === 'equipe') content = <TeamPage ctx={ctx} />
  else if (section === 'livraisons') content = <DeliveriesPage ctx={ctx} />
  else if (section === 'site-public') content = <PublicSitePage ctx={ctx} />
  else if (section === 'parametres') content = <SettingsPage ctx={ctx} />
  else content = <Dashboard ctx={ctx} />

  return (
    <div className="bq-page">
      <header className="bq-topbar">
        <a className="text-button" href="#/"><ArrowLeft size={15} /> Studio</a>
        <strong>{ctx.access.site.name}</strong>
        <span className="environment-pill" title="Votre rôle dans cet espace"><span /> {STAFF_ROLE_LABELS[staffRole]}</span>
      </header>
      <div className="bq-shell">
        <nav className="bq-nav" aria-label="Espace de gestion">
          {menu.map(({ section: target, label, icon: Icon }) => (
            <a key={target} href={boutiquePath(ctx.siteId, target)} className={target === current.section ? 'nav-link active' : 'nav-link'} aria-current={target === current.section ? 'page' : undefined}>
              <Icon size={17} /><span>{label}</span>
            </a>
          ))}
          <p className="nav-caption bq-nav-caption">BIENTÔT</p>
          {SOON.map(({ label, milestone, icon: Icon }) => (
            <span key={label} className="nav-link muted bq-soon" aria-disabled="true" title={`Jalon ${milestone} : pas encore disponible`}>
              <Icon size={17} /><span>{label}</span><small>{milestone}</small>
            </span>
          ))}
        </nav>
        <main className="bq-main">{content}</main>
      </div>
    </div>
  )
}
