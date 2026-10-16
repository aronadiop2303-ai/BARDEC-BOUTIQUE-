/** Préfixes de private.next_document_number. */
export const DOCUMENT_PREFIXES = {
  receipt: 'TICKET',
  invoice: 'FACT',
  credit_note: 'AVOIR',
  quote: 'DEVIS',
  delivery_note: 'BL',
} as const

export type DocumentType = keyof typeof DOCUMENT_PREFIXES

/** TICKET-2026-000001 : préfixe, année, numéro sur 6 chiffres au moins. */
export function formatDocumentNumber(type: DocumentType, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Numéro de document invalide.')
  return `${DOCUMENT_PREFIXES[type]}-${year}-${String(sequence).padStart(6, '0')}`
}

export function parseDocumentNumber(value: string): { prefix: string; year: number; sequence: number } | null {
  const match = /^([A-Z]{2,12})-(\d{4})-(\d{6,})$/.exec(value)
  return match ? { prefix: match[1], year: Number(match[2]), sequence: Number(match[3]) } : null
}

/** Vrai si les numéros se suivent sans trou ni doublon (même préfixe, même année). */
export function isContinuous(numbers: string[]): boolean {
  const parsed = numbers.map(parseDocumentNumber)
  if (parsed.some((p) => p === null)) return false
  const list = parsed as { prefix: string; year: number; sequence: number }[]
  return list.every((p, i) => i === 0 || (p.prefix === list[0].prefix && p.year === list[0].year && p.sequence === list[i - 1].sequence + 1))
}
