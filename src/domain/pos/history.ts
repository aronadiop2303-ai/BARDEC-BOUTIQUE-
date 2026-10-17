import type { ReceiptSnapshot } from './receipt'

/**
 * Historique des ventes : filtres et libellés tirés de l'instantané figé (content_snapshot).
 * Rien n'est recalculé : le mode de paiement et le vendeur sont ceux écrits par record_sale.
 */

export const SHOP_TIME_ZONE = 'Africa/Dakar'

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Date du jour (AAAA-MM-JJ) dans le fuseau de la boutique. */
export function shopToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Instant UTC du début du jour AAAA-MM-JJ à Dakar (UTC+0 toute l'année, sans heure d'été). */
function dakarStartOfDay(day: string): Date | null {
  const match = DAY.exec(day)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === day ? date : null
}

/**
 * Intervalle [from, to[ couvrant les jours `fromDay` à `toDay` inclus, ou un message d'erreur.
 * Les jours sont saisis au format des champs date (AAAA-MM-JJ).
 */
export function dayRange(fromDay: string, toDay: string): { ok: true; from: string; to: string } | { ok: false; message: string } {
  const start = dakarStartOfDay(fromDay)
  const end = dakarStartOfDay(toDay)
  if (!start || !end) return { ok: false, message: 'Date invalide.' }
  if (end < start) return { ok: false, message: 'La date de fin précède la date de début.' }
  const next = new Date(end.getTime() + 86_400_000)
  return { ok: true, from: start.toISOString(), to: next.toISOString() }
}

/** Recherche par numéro : majuscules, seulement lettres, chiffres et tirets (« ticket-2026-42 » → « TICKET-2026-42 »). */
export function normalizeNumberSearch(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30)
}

/** Modes de paiement de l'instantané, dans l'ordre, sans doublon : « Espèces + Wave ». */
export function paymentModes(snapshot: ReceiptSnapshot | null): string {
  if (!snapshot) return '—'
  const labels = [...new Set(snapshot.payments.map((p) => p.label || p.method).filter(Boolean))]
  return labels.length ? labels.join(' + ') : '—'
}

/** Vendeur inscrit dans l'instantané au moment de la vente. */
export function sellerName(snapshot: ReceiptSnapshot | null): string {
  return snapshot?.cashier?.name?.trim() || '—'
}

const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: SHOP_TIME_ZONE })

/** Date et heure à Dakar : « 16/10/2026 09:30 ». */
export function formatShopDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}
