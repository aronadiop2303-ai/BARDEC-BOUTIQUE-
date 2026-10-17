import { csvCell } from '../import/csv'
import { shopToday } from '../pos/history'

/**
 * Rapports : mise en forme et export des lignes renvoyées par la base. Aucun montant n'est calculé ici.
 */

export type Column<T> = { key: keyof T; label: string; kind?: 'text' | 'number' | 'date' }

const BOM = String.fromCharCode(0xfeff)

/** Nombre au format tableur français : virgule décimale, sans séparateur de milliers (relu sans ambiguïté). */
export function csvNumber(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 1000) / 1000).replace('.', ',')
}

/** CSV UTF-8 avec marque d'ordre, séparateur « ; » (Excel en français), fin de ligne CRLF. */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: Column<T>[]): string {
  const header = columns.map((c) => csvCell(c.label, ';')).join(';')
  const body = rows.map((row) => columns.map((c) => {
    const value = row[c.key]
    if (value === null || value === undefined) return ''
    if (c.kind === 'number') return csvNumber(value)
    return csvCell(String(value), ';')
  }).join(';'))
  return BOM + [header, ...body].join('\r\n') + '\r\n'
}

const DAY = 86_400_000
const iso = (date: Date) => date.toISOString().slice(0, 10)

/** Intervalles prédéfinis (jours à Dakar, UTC+0) : aujourd'hui, 7 jours, mois en cours, mois précédent. */
export function presetRange(preset: 'today' | 'last7' | 'month' | 'previousMonth', now = new Date()): { from: string; to: string } {
  const today = shopToday(now)
  const [y, m] = today.split('-').map(Number)
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'last7') return { from: iso(new Date(Date.parse(today) - 6 * DAY)), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  const first = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1))
  const last = new Date(Date.UTC(y, m - 1, 1) - DAY)
  return { from: iso(first), to: iso(last) }
}

export type Granularity = 'day' | 'week' | 'month'

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

/** Libellé d'une période renvoyée par la base (date du début de période). */
export function periodLabel(period: string, granularity: Granularity): string {
  const date = new Date(`${period}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return period
  if (granularity === 'month') return monthFormat.format(date)
  if (granularity === 'week') return `Semaine du ${dayFormat.format(date)}`
  return dayFormat.format(date)
}

/** Taux de marge (marge / chiffre d'affaires) à partir des deux montants de la base ; null si CA nul. */
export function marginRate(margin: number, revenue: number): number | null {
  return revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null
}
