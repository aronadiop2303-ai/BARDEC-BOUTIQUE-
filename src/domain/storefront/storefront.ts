import { formatMoney } from '../hardware/money'

/** Disponibilité publique renvoyée par la base : jamais de quantité. */
export type Availability = 'in_stock' | 'out_of_stock' | 'on_order' | 'available'

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: 'En stock',
  out_of_stock: 'Rupture de stock',
  on_order: 'Sur commande',
  available: 'Disponible',
}

export const availabilityLabel = (value: string | null | undefined) =>
  AVAILABILITY_LABELS[value as Availability] ?? 'Disponibilité à confirmer'

/**
 * Numéro WhatsApp au format international sans « + » (wa.me) : « 77 123 45 67 » → « 221771234567 ».
 * Numéro sénégalais à 9 chiffres (7x ou 3x) complété par l'indicatif 221 ; « 00 » initial retiré.
 * null si le numéro est inutilisable.
 */
export function normalizeWhatsapp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 9 && /^[37]/.test(digits)) digits = `221${digits}`
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

export type OrderLine = { name: string; price: number; currency: string; unit?: string | null }

/** Message pré-rempli : rien n'est envoyé automatiquement, le client relit et envoie lui-même. */
export function orderMessage(shopName: string, product: OrderLine | null, pageUrl: string): string {
  if (!product) return `Bonjour ${shopName}, je souhaite passer une commande. (${pageUrl})`
  const unit = product.unit ? ` / ${product.unit}` : ''
  return `Bonjour ${shopName}, je souhaite commander : ${product.name} (${formatMoney(product.price, product.currency)}${unit}). Quantité : … (${pageUrl})`
}

export function whatsappOrderUrl(number: string | null, message: string): string | null {
  const to = normalizeWhatsapp(number)
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null
}

/** Familles affichées : seulement celles qui ont au moins un produit actif (déjà filtré par la base). */
export type StoreCategory = { id: string; parent_id: string | null; name: string; slug: string; product_count: number }

export function topCategories(categories: StoreCategory[]): StoreCategory[] {
  return [...categories].sort((a, b) => b.product_count - a.product_count || a.name.localeCompare(b.name, 'fr'))
}
