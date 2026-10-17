/**
 * Tableau brut produit par une source d'import (CSV, Excel, collage, saisie en série) :
 * une ligne d'en-têtes et des lignes de cellules texte, avant tout mapping.
 * `lines[i]` est le numéro (à partir de 1) de la ligne `rows[i]` dans la source, en-têtes compris,
 * pour que les erreurs désignent la ligne que l'utilisateur voit dans son tableur.
 */
export type RawTable = { headers: string[]; rows: string[][]; lines: number[] }

/** Une ligne est vide si toutes ses cellules le sont (espaces compris). */
export const isBlankRow = (row: string[]) => row.every((cell) => cell.trim() === '')

const BOM = String.fromCharCode(0xfeff)

/** Première ligne non vide = en-têtes ; lignes vides retirées ; chaque ligne complétée à la même largeur. */
export function tableFromMatrix(matrix: string[][]): RawTable {
  const start = matrix.findIndex((row) => !isBlankRow(row))
  if (start === -1) return { headers: [], rows: [], lines: [] }
  const headers = matrix[start].map((h) => h.split(BOM).join('').trim())
  const body = matrix.slice(start + 1).map((row, i) => ({ row, line: start + i + 2 })).filter(({ row }) => !isBlankRow(row))
  const width = body.reduce((max, { row }) => Math.max(max, row.length), headers.length)
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? '')
  return {
    headers: pad(headers).map((h, i) => h || `Colonne ${i + 1}`),
    rows: body.map(({ row }) => pad(row)),
    lines: body.map(({ line }) => line),
  }
}
