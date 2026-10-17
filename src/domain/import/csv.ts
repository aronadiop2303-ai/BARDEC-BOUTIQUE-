import { tableFromMatrix, type RawTable } from './table'

export type Delimiter = ';' | ',' | '\t'

/**
 * Séparateur le plus probable : celui qui apparaît le plus souvent, hors guillemets, sur la première
 * ligne non vide, à nombre égal sur les lignes suivantes. Préférence à « ; » (Excel en français),
 * puis tabulation (collage depuis un tableur), puis « , ».
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((line) => line.trim() !== '').slice(0, 5)
  const candidates: Delimiter[] = [';', '\t', ',']
  const count = (line: string, d: string) => {
    let n = 0
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === d && !quoted) n += 1
    }
    return n
  }
  let best: Delimiter = ';'
  let bestScore = -1
  for (const d of candidates) {
    const counts = lines.map((line) => count(line, d))
    const first = counts[0] ?? 0
    if (first === 0) continue
    const consistent = counts.filter((n) => n === first).length
    const score = consistent * 1000 + first
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

/**
 * Lecture CSV (RFC 4180) : champs entre guillemets, guillemets doublés, retours à la ligne dans un champ,
 * fins de ligne CRLF, LF ou CR, marque d'ordre UTF-8 retirée.
 */
export function parseCsvMatrix(text: string, delimiter: Delimiter): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** CSV ou texte collé → tableau brut (séparateur détecté si non fourni). */
export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): RawTable {
  return tableFromMatrix(parseCsvMatrix(text, delimiter))
}

/** Échappe une cellule pour un CSV au séparateur donné. */
export function csvCell(value: string, delimiter: Delimiter): string {
  return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value
}
