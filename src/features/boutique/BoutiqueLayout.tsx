import { ArrowLeft, Boxes, ClipboardList, FileText, FolderTree, LayoutDashboard, Package, Receipt, Settings2, Truck, Users, UsersRound, BarChart3 } from 'lucide-react'
import { boutiquePath, type BoutiqueSection } from '../../lib/router'
import { ROLE_LABELS } from '../../lib/store/permissions'
import type { BoutiqueContext } from './context'
import Dashboard from './Dashboard'
import FamiliesPage from './FamiliesPage'
import ProductForm from './ProductForm'
import ProductsPage from './ProductsPage'
import SettingsPage from './SettingsPage'
import StockPage from './StockPage'

const MENU: { section: BoutiqueSection; label: string; icon: typeof Package }[] = [
  { section: 'tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
  { section: 'produits', label: 'Produits', icon: Package },
  { section: 'familles', label: 'Familles', icon: FolderTree },
  { section: 'stock', label: 'Stock', icon: Boxes },
  { section: 'parametres', label: 'Paramètres boutique', icon: Settings2 },
]

/** Sections prévues, visibles mais inactives : aucun faux contenu. */
const SOON: { label: string; milestone: string; icon: typeof Package }[] = [
  { label: 'Ventes et caisse', milestone: 'Q3', icon: Receipt },
  { label: 'Clients et crédits', milestone: 'Q4', icon: Users },
  { label: 'Fournisseurs et achats', milestone: 'Q4', icon: Truck },
  { label: 'Devis et documents', milestone: 'Q5', icon: FileText },
  { label: 'Rapports', milestone: 'Q6', icon: BarChart3 },
  { label: 'Équipe', milestone: 'Q6', icon: UsersRound },
  { label: 'Journal d’audit', milestone: 'Q6', icon: ClipboardList },
]

export default function BoutiqueLayout({ ctx, section, itemId }: { ctx: BoutiqueContext; section: BoutiqueSection; itemId: string | null }) {
  const current = MENU.find((item) => item.section === section) ?? MENU[0]

  let content
  if (section === 'produits' && itemId) content = <ProductForm ctx={ctx} productId={itemId === 'nouveau' ? null : itemId} />
  else if (section === 'produits') content = <ProductsPage ctx={ctx} />
  else if (section === 'familles') content = <FamiliesPage ctx={ctx} />
  else if (section === 'stock') content = <StockPage ctx={ctx} />
  else if (section === 'parametres') content = <SettingsPage ctx={ctx} />
  else content = <Dashboard ctx={ctx} />

  return (
    <div className="bq-page">
      <header className="bq-topbar">
        <a className="text-button" href="#/"><ArrowLeft size={15} /> Studio</a>
        <strong>{ctx.access.site.name}</strong>
        <span className="environment-pill" title="Votre rôle dans cet espace"><span /> {ROLE_LABELS[ctx.access.role]}</span>
      </header>
      <div className="bq-shell">
        <nav className="bq-nav" aria-label="Espace de gestion">
          {MENU.map(({ section: target, label, icon: Icon }) => (
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
