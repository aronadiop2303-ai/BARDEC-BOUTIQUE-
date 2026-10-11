import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  ExternalLink,
  FileText,
  Globe2,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Sparkles,
  Store,
  WandSparkles,
  X,
} from 'lucide-react'

type Site = {
  id: number
  name: string
  category: string
  status: 'Brouillon' | 'Publié'
  updated: string
  accent: string
  icon: 'store' | 'school' | 'business'
}

const initialSites: Site[] = [
  { id: 1, name: 'Ma boutique', category: 'Commerce', status: 'Brouillon', updated: 'Modifié aujourd’hui', accent: 'mint', icon: 'store' },
  { id: 2, name: 'École Excellence', category: 'Éducation', status: 'Publié', updated: 'Modifié hier', accent: 'blue', icon: 'school' },
  { id: 3, name: 'Diop Immobilier', category: 'Immobilier', status: 'Brouillon', updated: 'Modifié le 8 oct.', accent: 'sand', icon: 'business' },
]

const templates = [
  { label: 'Site vitrine', description: 'Présentez votre activité et vos services.', icon: BriefcaseBusiness, color: 'template-blue' },
  { label: 'Commerce', description: 'Un catalogue pour vos produits et votre boutique.', icon: ShoppingBag, color: 'template-mint' },
  { label: 'Éducation', description: 'Un site pour une école ou un centre de formation.', icon: GraduationCap, color: 'template-violet' },
  { label: 'Immobilier', description: 'Présentez des biens et recevez des demandes.', icon: Globe2, color: 'template-sand' },
  { label: 'Portfolio / Média', description: 'Publiez vos créations, articles et actualités.', icon: BookOpen, color: 'template-pink' },
  { label: 'Personnalisé', description: 'Commencez simplement et choisissez vos blocs.', icon: WandSparkles, color: 'template-dark' },
]

function SiteGlyph({ icon }: { icon: Site['icon'] }) {
  if (icon === 'school') return <GraduationCap size={22} />
  if (icon === 'business') return <Globe2 size={22} />
  return <ShoppingBag size={22} />
}

export default function App() {
  const [sites, setSites] = useState(initialSites)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('Site vitrine')
  const [siteName, setSiteName] = useState('')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [activeNav, setActiveNav] = useState('Vue d’ensemble')
  const filteredSites = useMemo(
    () => sites.filter((site) => `${site.name} ${site.category} ${site.status}`.toLowerCase().includes(query.toLowerCase())),
    [sites, query],
  )

  function createSite() {
    const cleanName = siteName.trim()
    if (!cleanName) {
      setNotice('Donnez un nom à votre site pour continuer.')
      return
    }
    const newSite: Site = {
      id: Date.now(),
      name: cleanName,
      category: selectedTemplate,
      status: 'Brouillon',
      updated: 'Créé à l’instant',
      accent: ['mint', 'blue', 'sand'][sites.length % 3],
      icon: selectedTemplate === 'Éducation' ? 'school' : selectedTemplate === 'Commerce' ? 'store' : 'business',
    }
    setSites((current) => [newSite, ...current])
    setCreateOpen(false)
    setSiteName('')
    setQuery('')
    setNotice(`« ${cleanName} » a été ajouté à vos projets locaux. La publication réelle n’est pas encore connectée.`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="BARDEC-BOUTIQUE Studio">
          <span className="brand-mark"><span>B</span><span>∞</span></span>
          <span className="brand-copy"><strong>BARDEC</strong><small>BOUTIQUE STUDIO</small></span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">A</span>
          <span className="workspace-label"><strong>Mon espace</strong><small>Espace personnel</small></span>
          <ChevronDown size={16} />
        </div>
        <p className="nav-caption">ESPACE DE TRAVAIL</p>
        <nav className="main-nav" aria-label="Navigation principale">
          {[
            { label: 'Vue d’ensemble', icon: LayoutDashboard },
            { label: 'Mes sites', icon: Globe2 },
            { label: 'Modèles', icon: FileText },
            { label: 'Découverte', icon: Compass },
          ].map(({ label, icon: Icon }) => (
            <button className={activeNav === label ? 'nav-link active' : 'nav-link'} key={label} onClick={() => setActiveNav(label)}>
              <Icon size={18} /><span>{label}</span>{label === 'Découverte' && <span className="soon-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon"><CircleHelp size={18} /></span>
            <strong>Besoin d’aide ?</strong>
            <p>Apprenez à créer votre premier site.</p>
            <button onClick={() => setNotice('Le centre d’aide sera connecté dans une prochaine phase.')}>Consulter le guide <ArrowUpRight size={14} /></button>
          </div>
          <button className="nav-link muted" onClick={() => setNotice('Les paramètres de l’espace seront ajoutés avec l’authentification.')}><Settings2 size={18} /><span>Paramètres</span></button>
          <div className="user-row"><span className="user-avatar">AD</span><span className="user-copy"><strong>Administrateur</strong><small>Compte de démonstration</small></span><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Ouvrir le menu" onClick={() => setNotice('Navigation mobile en cours de préparation.')}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Mon espace</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
          <div className="top-actions">
            <span className="environment-pill"><span /> Prototype Studio</span>
            <button className="icon-button" aria-label="Notifications" onClick={() => setNotice('Vous êtes à jour : aucune notification de démonstration.')}><Bell size={18} /></button>
            <span className="top-avatar">AD</span>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">VOTRE ESPACE DE CRÉATION</p>
              <h1>Tout commence par une idée<span>.</span></h1>
              <p className="welcome-subtitle">Créez un site pour votre activité, personnalisez-le et préparez sa publication.</p>
            </div>
            <button className="primary-button" onClick={() => { setCreateOpen(true); setNotice('') }}><Plus size={18} /> Créer un site</button>
          </section>

          {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Fermer le message" onClick={() => setNotice('')}><X size={16} /></button></div>}

          <section className="hero-panel">
            <div className="hero-copy">
              <span className="hero-kicker"><Sparkles size={14} /> LA CRÉATION WEB, AUTREMENT</span>
              <h2>Votre activité mérite<br />son propre espace web.</h2>
              <p>Une école, une boutique, une entreprise ou un projet : choisissez votre point de départ. Vous gardez le contrôle sur le contenu et la publication.</p>
              <button className="hero-button" onClick={() => setCreateOpen(true)}>Commencer un site <ArrowUpRight size={16} /></button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" />
              <div className="floating-card card-one"><span className="mini-mark mint"><Store size={18} /></span><span><b>Ma boutique</b><small>Catalogue & services</small></span><Check size={16} /></div>
              <div className="floating-card card-two"><span className="mini-mark violet"><GraduationCap size={18} /></span><span><b>Mon école</b><small>Pages & inscriptions</small></span></div>
              <div className="hero-core"><span>∞</span><small>BARDEC</small></div>
              <div className="floating-card card-three"><span className="mini-mark sand"><Globe2 size={18} /></span><span><b>Mon projet</b><small>À votre image</small></span><ArrowUpRight size={15} /></div>
            </div>
          </section>

          <section className="stats-grid" aria-label="Résumé de l’espace">
            <article className="stat-card"><div className="stat-icon stat-blue"><Globe2 size={18} /></div><span className="stat-label">Sites dans mon espace</span><strong>{sites.length.toString().padStart(2, '0')}</strong><small><ArrowUpRight size={13} /> Vos projets web</small></article>
            <article className="stat-card"><div className="stat-icon stat-green"><Check size={18} /></div><span className="stat-label">Sites publiés</span><strong>{sites.filter((site) => site.status === 'Publié').length.toString().padStart(2, '0')}</strong><small>Publication simulée uniquement</small></article>
            <article className="stat-card"><div className="stat-icon stat-purple"><WandSparkles size={18} /></div><span className="stat-label">Modèles disponibles</span><strong>06</strong><small>Points de départ du prototype</small></article>
          </section>

          <section className="sites-section">
            <div className="section-heading"><div><h2>Vos sites</h2><p>Retrouvez vos projets et reprenez là où vous en étiez.</p></div><button className="text-button" onClick={() => setActiveNav('Mes sites')}>Voir tous les sites <ArrowUpRight size={15} /></button></div>
            <div className="sites-toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un site..." /></label><button className="filter-button" onClick={() => setNotice('Les filtres avancés seront ajoutés avec les données réelles.')}>Tous les sites <ChevronDown size={15} /></button></div>
            <div className="site-grid">
              {filteredSites.map((site) => (
                <article className="site-card" key={site.id}>
                  <div className={`site-preview preview-${site.accent}`}>
                    <div className="preview-browser"><span /><span /><span /><small>{site.name.toLowerCase().replaceAll(' ', '-')}.bardec.site</small></div>
                    <div className="preview-page"><span className="preview-logo"><SiteGlyph icon={site.icon} /> {site.name}</span><div className="preview-lines"><i /><i /><i /></div><div className="preview-button" /><div className="preview-image" /></div>
                    <button className="preview-open" aria-label={`Prévisualiser ${site.name}`} onClick={() => setNotice('L’aperçu interactif sera disponible après la mise en place du moteur de rendu.')}><ExternalLink size={15} /></button>
                  </div>
                  <div className="site-card-body"><div className="site-title-row"><span className={`site-icon icon-${site.accent}`}><SiteGlyph icon={site.icon} /></span><button className="more-button" aria-label={`Options de ${site.name}`} onClick={() => setNotice('Les actions de gestion seront ajoutées dans la prochaine étape.')}><MoreHorizontal size={18} /></button></div><h3>{site.name}</h3><p>{site.category} <span>·</span> {site.updated}</p><div className="site-card-footer"><span className={site.status === 'Publié' ? 'status status-published' : 'status status-draft'}><span />{site.status}</span><button className="edit-button" onClick={() => setNotice(`L’éditeur de « ${site.name} » sera la prochaine fonctionnalité à construire.`)}>Ouvrir <ArrowUpRight size={14} /></button></div></div>
                </article>
              ))}
              <button className="new-site-card" onClick={() => setCreateOpen(true)}><span className="new-site-icon"><Plus size={22} /></span><strong>Créer un nouveau site</strong><span>Choisissez un modèle et donnez vie à votre projet.</span></button>
            </div>
            {filteredSites.length === 0 && <div className="empty-state"><Search size={22} /><strong>Aucun site trouvé</strong><span>Essayez un autre nom ou une autre catégorie.</span></div>}
          </section>
          <footer className="footer-note"><span>BARDEC-BOUTIQUE <b>·</b> Studio de création</span><span><span className="footer-status" /> Prototype local — données de démonstration</span></footer>
        </div>
      </main>

      {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false) }}>
        <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="modal-header"><div><span className="eyebrow">NOUVEAU PROJET</span><h2 id="create-title">Quel site voulez-vous créer ?</h2><p>Choisissez un point de départ. Vous pourrez le personnaliser ensuite.</p></div><button className="icon-button" aria-label="Fermer" onClick={() => setCreateOpen(false)}><X size={19} /></button></div>
          <div className="template-grid">{templates.map(({ label, description, icon: Icon, color }) => <button key={label} className={selectedTemplate === label ? 'template-option selected' : 'template-option'} onClick={() => setSelectedTemplate(label)}><span className={`template-icon ${color}`}><Icon size={21} /></span><span className="template-text"><strong>{label}</strong><small>{description}</small></span><span className="template-check">{selectedTemplate === label && <Check size={14} />}</span></button>)}</div>
          <label className="field-label" htmlFor="site-name">Nom de votre site</label><input id="site-name" className="name-input" autoFocus value={siteName} onChange={(event) => setSiteName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createSite() }} placeholder="Ex. : Ma nouvelle activité" />
          <div className="modal-footnote"><Sparkles size={15} /><span>Vous commencerez en brouillon. La publication en ligne sera ajoutée après le socle de création.</span></div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)}>Annuler</button><button className="primary-button" onClick={createSite}><Plus size={17} /> Créer le brouillon</button></div>
        </section>
      </div>}
    </div>
  )
}
