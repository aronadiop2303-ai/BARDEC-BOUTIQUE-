
create index if not exists business_inquiries_offering_id_idx on public.business_inquiries(offering_id);
create index if not exists cart_items_variant_id_idx on public.cart_items(variant_id);
create index if not exists inventory_movements_actor_user_id_idx on public.inventory_movements(actor_user_id);
create index if not exists inventory_movements_variant_id_idx on public.inventory_movements(variant_id);
create index if not exists order_items_variant_id_idx on public.order_items(variant_id);
create index if not exists orders_cart_id_idx on public.orders(cart_id);
create index if not exists product_categories_parent_id_idx on public.product_categories(parent_id);
create index if not exists products_category_site_idx on public.products(category_id, site_id);
