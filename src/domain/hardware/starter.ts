import type { Unit } from './units'

/** Famille de départ proposée à la configuration (public.product_categories, niveau racine). */
export type StarterFamily = { slug: string; name: string; description: string }

export const STARTER_FAMILIES: StarterFamily[] = [
  { slug: 'gros-oeuvre-materiaux', name: 'Gros œuvre et matériaux', description: 'Ciment, fer à béton, sable, gravier, parpaings, tôles, bois, carrelage.' },
  { slug: 'plomberie', name: 'Plomberie', description: 'Tuyaux PVC/PEHD, raccords, robinetterie, sanitaires, pompes.' },
  { slug: 'electricite', name: 'Électricité', description: 'Câbles, disjoncteurs, prises, tableaux, éclairage, solaire.' },
  { slug: 'outillage', name: 'Outillage', description: 'Outils manuels, électroportatifs, mesure, brouettes, échelles.' },
  { slug: 'quincaillerie-batiment', name: 'Quincaillerie du bâtiment', description: 'Serrures, charnières, visserie, clous, chevilles, chaînes.' },
  { slug: 'peinture-finition', name: 'Peinture et finition', description: 'Peintures, vernis, enduits, pinceaux, diluants, mastics.' },
  { slug: 'securite-epi', name: 'Sécurité (EPI)', description: 'Casques, gants, bottes, lunettes, masques, extincteurs.' },
  { slug: 'jardin-agriculture', name: 'Jardin et agriculture', description: 'Arrosage, tuyaux, grillage, outils de jardin.' },
  { slug: 'soudure-consommables', name: 'Soudure et consommables', description: 'Électrodes, disques à tronçonner et à meuler.' },
  { slug: 'divers', name: 'Divers', description: 'Bâches, cordes, sacs, bidons.' },
]

export type StarterUnit = Omit<Unit, 'id'>

/** Unités de départ. Les codes respectent la contrainte SQL ^[a-z][a-z0-9_-]{0,23}$. */
export const STARTER_UNITS: StarterUnit[] = [
  { code: 'piece', label: 'Pièce', dimension: 'count', decimal_places: 0 },
  { code: 'paire', label: 'Paire', dimension: 'count', decimal_places: 0 },
  { code: 'boite', label: 'Boîte', dimension: 'count', decimal_places: 0 },
  { code: 'carton', label: 'Carton', dimension: 'count', decimal_places: 0 },
  { code: 'paquet', label: 'Paquet', dimension: 'count', decimal_places: 0 },
  { code: 'sac', label: 'Sac', dimension: 'count', decimal_places: 0 },
  { code: 'kg', label: 'Kilogramme', dimension: 'mass', decimal_places: 3 },
  { code: 'tonne', label: 'Tonne', dimension: 'mass', decimal_places: 3 },
  { code: 'm', label: 'Mètre', dimension: 'length', decimal_places: 2 },
  { code: 'rouleau', label: 'Rouleau', dimension: 'count', decimal_places: 0 },
  { code: 'litre', label: 'Litre', dimension: 'volume', decimal_places: 2 },
  { code: 'bidon', label: 'Bidon', dimension: 'count', decimal_places: 0 },
  { code: 'm2', label: 'Mètre carré', dimension: 'area', decimal_places: 2 },
  { code: 'm3', label: 'Mètre cube', dimension: 'volume', decimal_places: 3 },
  { code: 'voyage', label: 'Voyage (camion)', dimension: 'other', decimal_places: 0 },
]

export type StarterLocation = { key: string; name: string; location_type: 'store' | 'warehouse' | 'vehicle' }

export const STARTER_LOCATIONS: StarterLocation[] = [
  { key: 'magasin', name: 'Magasin', location_type: 'store' },
  { key: 'depot', name: 'Dépôt', location_type: 'warehouse' },
  { key: 'vehicule', name: 'Chantier / Véhicule', location_type: 'vehicle' },
]

/** Attributs métier proposés dans la fiche produit (products.attributes, jamais obligatoires). */
export const PRODUCT_ATTRIBUTES: { key: string; label: string }[] = [
  { key: 'brand', label: 'Marque' },
  { key: 'manufacturer_ref', label: 'Référence fabricant' },
  { key: 'dimension', label: 'Dimension / diamètre' },
  { key: 'length', label: 'Longueur' },
  { key: 'material', label: 'Matière' },
  { key: 'standard', label: 'Norme' },
  { key: 'power', label: 'Tension / puissance' },
  { key: 'color', label: 'Couleur' },
  { key: 'origin', label: 'Origine' },
]
