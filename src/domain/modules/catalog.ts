import type { ModuleManifest } from './types'

/**
 * Catalogue des modules fonctionnels (docs/MODULES.md).
 * Règle : 'available' UNIQUEMENT pour ce qui est réellement livré et utilisable (Catalogue, Stocks en consultation).
 * Tout le reste est 'soon' et n'est jamais activable.
 * Ce registre est du code : il ne remplace pas la table module_catalog, qui recense les SECTEURS (hardware_building…).
 */

// ── Modules transversaux ─────────────────────────────────────────────────────

const TRANSVERSAL: ModuleManifest[] = [
  {
    key: 'users_roles', name: 'Utilisateurs & Rôles', category: 'transversal', group: 'admin', status: 'soon',
    description: 'Inviter des membres dans un espace et leur attribuer un rôle.',
    dependsOn: [], requiredTables: ['workspaces', 'workspace_memberships', 'profiles'],
    requiredPermissions: ['users.manage'],
    navigation: [{ id: 'equipe', label: 'Équipe' }],
  },
  {
    key: 'hr', name: 'Ressources humaines', category: 'transversal', group: 'admin', status: 'soon',
    description: 'Fiches employés, contrats, congés et présences.',
    dependsOn: ['users_roles'], requiredTables: ['employees', 'employment_contracts', 'leave_requests'],
    requiredPermissions: ['hr.manage'],
    navigation: [{ id: 'rh', label: 'Ressources humaines' }],
  },
  {
    key: 'multi_site', name: 'Multi-sites', category: 'transversal', group: 'admin', status: 'soon',
    description: 'Piloter plusieurs sites ou points de vente depuis un même espace.',
    dependsOn: ['users_roles'], requiredTables: ['workspaces', 'sites'],
    requiredPermissions: ['sites.manage'],
    navigation: [{ id: 'multi-sites', label: 'Multi-sites' }],
  },
  {
    key: 'secretariat', name: 'Secrétariat', category: 'transversal', group: 'admin', status: 'soon',
    description: 'Courrier entrant et sortant, agenda et tâches administratives.',
    dependsOn: ['contacts'], requiredTables: ['correspondence_log', 'admin_tasks'],
    requiredPermissions: ['secretariat.use'],
    navigation: [{ id: 'secretariat', label: 'Secrétariat' }],
  },
  {
    key: 'treasury', name: 'Trésorerie', category: 'transversal', group: 'finance', status: 'soon',
    description: 'Comptes (caisse, banque, mobile money déclaré), soldes et rapprochements.',
    dependsOn: [], requiredTables: ['treasury_accounts', 'treasury_entries'],
    requiredPermissions: ['finance.read'],
    navigation: [{ id: 'tresorerie', label: 'Trésorerie' }],
  },
  {
    key: 'invoicing', name: 'Facturation', category: 'transversal', group: 'finance', status: 'soon',
    description: 'Factures, avoirs et numérotation recalculés par la base.',
    dependsOn: ['contacts', 'treasury'], requiredTables: ['invoices', 'invoice_items', 'store_document_settings'],
    requiredPermissions: ['finance.read'],
    navigation: [{ id: 'facturation', label: 'Facturation' }],
  },
  {
    key: 'expenses_suppliers', name: 'Dépenses & Fournisseurs', category: 'transversal', group: 'finance', status: 'soon',
    description: 'Fiches fournisseurs et dépenses courantes.',
    dependsOn: ['contacts', 'treasury'], requiredTables: ['suppliers', 'expenses'],
    requiredPermissions: ['finance.read'],
    navigation: [{ id: 'depenses', label: 'Dépenses & Fournisseurs' }],
  },
  {
    key: 'contacts', name: 'Contacts', category: 'transversal', group: 'crm', status: 'soon',
    description: 'Carnet d’adresses commun : clients, fournisseurs, partenaires.',
    dependsOn: [], requiredTables: ['contacts'],
    requiredPermissions: ['contacts.read'],
    navigation: [{ id: 'contacts', label: 'Contacts' }],
  },
  {
    key: 'communication', name: 'Communication', category: 'transversal', group: 'crm', status: 'soon',
    description: 'Messages aux contacts (SMS, WhatsApp, e-mail) avec consentement.',
    dependsOn: ['contacts'], requiredTables: ['message_campaigns', 'message_log'],
    requiredPermissions: ['communication.send'],
    navigation: [{ id: 'communication', label: 'Communication' }],
  },
  {
    key: 'support', name: 'Support & SAV', category: 'transversal', group: 'crm', status: 'soon',
    description: 'Demandes, réclamations, retours et garanties.',
    dependsOn: ['contacts'], requiredTables: ['support_tickets', 'business_inquiries'],
    requiredPermissions: ['support.use'],
    navigation: [{ id: 'sav', label: 'Support & SAV' }],
  },
  {
    key: 'bookings', name: 'Réservations', category: 'transversal', group: 'crm', status: 'soon',
    description: 'Rendez-vous, créneaux et ressources réservables.',
    dependsOn: ['contacts'], requiredTables: ['bookings', 'booking_resources'],
    requiredPermissions: ['bookings.manage'],
    navigation: [{ id: 'reservations', label: 'Réservations' }],
  },
  {
    key: 'logistics_fleet', name: 'Logistique & Flotte', category: 'transversal', group: 'vertical', status: 'soon',
    description: 'Véhicules, chauffeurs et tournées de livraison.',
    dependsOn: [], requiredTables: ['vehicles', 'delivery_routes'],
    requiredPermissions: ['logistics.manage'],
    navigation: [{ id: 'logistique', label: 'Logistique & Flotte' }],
  },
  {
    key: 'education', name: 'Pédagogique', category: 'sectoral', group: 'vertical', status: 'soon',
    description: 'Élèves, classes, inscriptions et notes. Données sensibles : module isolé.',
    dependsOn: ['contacts', 'users_roles'], requiredTables: ['students', 'classes', 'enrollments'],
    requiredPermissions: ['education.manage'],
    navigation: [{ id: 'pedagogie', label: 'Pédagogique' }],
  },
  {
    key: 'projects_worksites', name: 'Projets & Chantiers', category: 'transversal', group: 'vertical', status: 'soon',
    description: 'Projets, chantiers, tâches et matériaux affectés.',
    dependsOn: ['contacts'], requiredTables: ['projects', 'project_tasks'],
    requiredPermissions: ['projects.manage'],
    navigation: [{ id: 'chantiers', label: 'Projets & Chantiers' }],
  },
  {
    key: 'ai_copilot', name: 'Copilote IA', category: 'transversal', group: 'intelligence', status: 'soon',
    description: 'Assistant qui explique, propose et prépare des brouillons, sans jamais agir seul.',
    dependsOn: ['analytics'], requiredTables: ['ai_conversations'],
    requiredPermissions: ['ai.use'],
    navigation: [{ id: 'copilote', label: 'Copilote IA' }],
  },
  {
    key: 'workflows', name: 'Workflows', category: 'transversal', group: 'intelligence', status: 'soon',
    description: 'Automatisations déclenchées par des événements (alerte, relance).',
    dependsOn: [], requiredTables: ['workflow_definitions', 'workflow_runs'],
    requiredPermissions: ['workflows.manage'],
    navigation: [{ id: 'workflows', label: 'Workflows' }],
  },
  {
    key: 'analytics', name: 'Analytique', category: 'transversal', group: 'intelligence', status: 'soon',
    description: 'Indicateurs et tableaux de bord calculés par la base.',
    dependsOn: [], requiredTables: [],
    requiredPermissions: ['analytics.read'],
    navigation: [{ id: 'analytique', label: 'Analytique' }],
  },
]

// ── ERP quincaillerie (9 entrées) ────────────────────────────────────────────

const HARDWARE = 'hardware_building'

const HARDWARE_ERP: ModuleManifest[] = [
  {
    key: 'hw_catalog', name: 'Catalogue', category: 'sectoral', group: 'erp', status: 'available',
    sectorKey: HARDWARE, milestone: 'Q1',
    description: 'Produits, familles, unités de vente et paliers de prix par quantité.',
    dependsOn: [],
    requiredTables: ['products', 'product_categories', 'product_units', 'product_sell_units', 'price_tiers', 'product_compatibilities', 'business_profiles', 'site_commerce_modules'],
    requiredPermissions: ['catalog.read'],
    navigation: [{
      id: 'catalogue', label: 'Catalogue',
      children: [
        { id: 'catalogue.produits', label: 'Produits' },
        { id: 'catalogue.categories', label: 'Catégories' },
        { id: 'catalogue.unites', label: 'Unités & Conditionnements', status: 'soon', note: 'Les conditionnements se saisissent déjà dans la fiche produit.' },
        { id: 'catalogue.tarifs-pro', label: 'Tarifs professionnels', status: 'soon', permission: 'catalog.write', note: 'Seuls les paliers par quantité existent (fiche produit).' },
        { id: 'catalogue.ean', label: 'Codes-barres EAN', status: 'soon', note: 'Champ code-barres libre dans la fiche produit ; ni contrôle EAN ni lecture.' },
        { id: 'catalogue.fiches-techniques', label: 'Fiches techniques', status: 'soon' },
        { id: 'catalogue.promotions', label: 'Promotions', status: 'soon', permission: 'catalog.write' },
        { id: 'catalogue.associes', label: 'Produits associés', status: 'soon', note: 'Table product_compatibilities présente, aucun écran.' },
      ],
    }],
  },
  {
    key: 'hw_stock', name: 'Stocks', category: 'sectoral', group: 'erp', status: 'available',
    sectorKey: HARDWARE, milestone: 'Q1 (partiel)',
    description: 'Niveaux de stock par emplacement, calculés depuis le registre des mouvements.',
    limitations: [
      'Consultation seule : aucune écriture permise sur inventory_movements (Q2).',
      'Calcul côté client limité à 5000 mouvements ; vue SQL prévue en Q2.',
      'Ni seuils ni alertes de rupture.',
    ],
    dependsOn: ['hw_catalog'],
    requiredTables: ['stock_locations', 'inventory_movements', 'products'],
    requiredPermissions: ['stock.read'],
    navigation: [{
      id: 'stock', label: 'Stocks',
      children: [
        { id: 'stock.niveaux', label: 'Niveaux de stock' },
        { id: 'stock.mouvements', label: 'Entrées et sorties', status: 'soon', permission: 'stock.write' },
        { id: 'stock.inventaires', label: 'Inventaires', status: 'soon', permission: 'stock.write' },
      ],
    }],
  },
  {
    key: 'hw_pos', name: 'Ventes et caisse', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q3',
    description: 'Vente comptoir, sessions de caisse, encaissements déclarés.',
    dependsOn: ['hw_catalog', 'hw_stock'],
    requiredTables: ['cash_register_sessions', 'cash_register_movements', 'orders', 'order_items', 'payment_transactions', 'store_documents'],
    requiredPermissions: ['sales.read'],
    navigation: [{ id: 'ventes', label: 'Ventes et caisse' }],
  },
  {
    key: 'hw_customers', name: 'Clients et crédit', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q4',
    description: 'Comptes clients, plafonds et suivi des crédits.',
    dependsOn: ['hw_pos', 'contacts'],
    requiredTables: ['customer_addresses', 'customer_accounts', 'customer_credit_entries'],
    requiredPermissions: ['customers.read'],
    navigation: [{ id: 'clients', label: 'Clients et crédit' }],
  },
  {
    key: 'hw_purchasing', name: 'Achats', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q4',
    description: 'Bons de commande fournisseurs et réception en stock.',
    dependsOn: ['hw_stock', 'expenses_suppliers'],
    requiredTables: ['purchase_orders', 'purchase_order_items', 'inventory_movements'],
    requiredPermissions: ['purchasing.read'],
    navigation: [{ id: 'achats', label: 'Achats' }],
  },
  {
    key: 'hw_quotes', name: 'Devis et documents', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q5',
    description: 'Devis, bons de livraison et avoirs.',
    dependsOn: ['hw_catalog', 'hw_customers', 'invoicing'],
    requiredTables: ['quotes', 'quote_items', 'store_documents', 'store_document_settings'],
    requiredPermissions: ['documents.read'],
    navigation: [{ id: 'devis', label: 'Devis et documents' }],
  },
  {
    key: 'hw_delivery', name: 'Livraisons', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q5',
    description: 'Expéditions et livraisons de chantier.',
    dependsOn: ['hw_pos'],
    requiredTables: ['shipments', 'orders'],
    requiredPermissions: ['delivery.read'],
    navigation: [{ id: 'livraisons', label: 'Livraisons' }],
  },
  {
    key: 'hw_reports', name: 'Rapports et alertes', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q6',
    description: 'Rapports de ventes et de stock, alertes, journal d’audit.',
    dependsOn: ['hw_pos', 'analytics'],
    requiredTables: ['store_alerts', 'store_audit_events', 'orders', 'inventory_movements'],
    requiredPermissions: ['reports.read'],
    navigation: [{ id: 'rapports', label: 'Rapports et alertes' }],
  },
  {
    key: 'hw_online_store', name: 'Vitrine en ligne', category: 'sectoral', group: 'erp', status: 'soon', sectorKey: HARDWARE, milestone: 'Q7',
    description: 'Catalogue public, panier et demandes de devis en ligne. Publication par le propriétaire seulement.',
    dependsOn: ['hw_catalog', 'hw_stock'],
    requiredTables: ['sites', 'site_pages', 'carts', 'cart_items', 'orders', 'business_inquiries'],
    requiredPermissions: ['online_store.manage'],
    navigation: [{ id: 'vitrine', label: 'Vitrine en ligne' }],
  },
]

export const MODULE_CATALOG: readonly ModuleManifest[] = [...TRANSVERSAL, ...HARDWARE_ERP]
