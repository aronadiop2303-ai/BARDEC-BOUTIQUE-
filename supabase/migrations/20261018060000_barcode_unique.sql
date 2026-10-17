-- =============================================================================
-- Codes-barres (lot J) : unicité du code-barres par boutique — ADDITIVE (nouvel index)
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : un nouvel index unique partiel sur public.products (site_id, barcode). Aucune colonne, politique ni
-- droit modifié. La colonne products.barcode existe déjà ; son unicité n'était pas garantie par une contrainte
-- versionnée dans ce dépôt.
--
-- AVANT APPLICATION (lecture seule) : le bloc 0 s'arrête, sans rien modifier, si des doublons existent. Pour les lister :
--   select site_id, barcode, count(*) from public.products
--   where nullif(btrim(barcode), '') is not null group by site_id, barcode having count(*) > 1;
-- Les doublons se corrigent dans les fiches produit (aucune correction automatique).
--
-- EFFET : deux produits d'une même boutique ne peuvent plus porter le même code-barres (le code vide ou absent
-- reste autorisé pour plusieurs produits). L'interface affiche « Ce code-barres est déjà utilisé… ».
--
-- RETOUR ARRIÈRE : drop index if exists public.products_site_barcode_unique;
-- =============================================================================

do $prereq$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select 1 from public.products
    where nullif(btrim(barcode), '') is not null
    group by site_id, barcode having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception '% code(s)-barres en double dans une même boutique : corriger les fiches avant cette migration.', v_count;
  end if;
end;
$prereq$;

create unique index if not exists products_site_barcode_unique
  on public.products (site_id, barcode)
  where barcode is not null and btrim(barcode) <> '';
