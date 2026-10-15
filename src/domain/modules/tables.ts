/**
 * Tables du schéma public relevées en lecture seule sur le projet réel
 * (information_schema.tables, 16/10/2026). À mettre à jour à chaque migration appliquée.
 */
export const VERIFIED_TABLES = [
  'business_inquiries', 'business_offerings', 'business_profiles', 'cart_items', 'carts',
  'cash_movements', 'cash_register_movements', 'cash_register_sessions', 'cash_sessions',
  'customer_addresses', 'inventory_movements', 'module_catalog', 'order_items', 'orders',
  'payment_transactions', 'price_tiers', 'product_batches', 'product_categories',
  'product_compatibilities', 'product_sell_units', 'product_service_profiles', 'product_units',
  'product_variants', 'products', 'profiles', 'quote_items', 'quotes', 'shipments',
  'site_categories', 'site_commerce_modules', 'site_pages', 'site_templates', 'sites',
  'stock_locations', 'store_alerts', 'store_audit_events', 'store_document_settings',
  'store_documents', 'stores', 'template_modules', 'workspace_memberships', 'workspaces',
] as const

/**
 * Tables existantes mais écartées (dettes connues) : un module ne doit jamais en dépendre.
 * Caisse : seules les tables cash_register_* sont utilisées. Boutique : seule la table sites est utilisée.
 */
export const DEPRECATED_TABLES = ['cash_sessions', 'cash_movements', 'stores'] as const
