import { tableFromMatrix, type RawTable } from './table'

/**
 * Lecture minimale d'un classeur Excel .xlsx, sans dépendance : archive ZIP (entrées stockées ou
 * compressées « deflate », décompressées par DecompressionStream du navigateur), première feuille,
 * textes partagés, textes en ligne, nombres et booléens. Les formules sont lues par leur dernière valeur
 * calculée enregistrée dans le fichier. Les dates restent des numéros de série Excel (aucune colonne
 * importée n'est une date). Fichiers .xls (ancien format binaire) non pris en charge.
 */

export const XLSX_MAX_BYTES = 5 * 1024 * 1024
const MAX_UNCOMPRESSED = 40 * 1024 * 1024

export class XlsxError extends Error {}

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number }

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError('Fichier Excel illisible : ce n’est pas un classeur .xlsx.')
  const count = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n += 1) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50) throw new XlsxError('Fichier Excel endommagé.')
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    entries.push({
      method: view.getUint16(pointer + 10, true),
      compressedSize: view.getUint32(pointer + 20, true),
      size: view.getUint32(pointer + 24, true),
      offset: view.getUint32(pointer + 42, true),
      name: decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength)),
    })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  if (entry.size > MAX_UNCOMPRESSED) throw new XlsxError('Classeur trop volumineux une fois décompressé.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new XlsxError('Fichier Excel endommagé.')
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const raw = bytes.subarray(start, start + entry.compressedSize)
  let data: Uint8Array
  if (entry.method === 0) data = raw
  else if (entry.method === 8) data = await inflateRaw(raw)
  else throw new XlsxError('Compression du classeur non prise en charge.')
  if (data.length > MAX_UNCOMPRESSED) throw new XlsxError('Classeur trop volumineux une fois décompressé.')
  return new TextDecoder().decode(data)
}

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, code: string) => {
    const lower = code.toLowerCase()
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'amp') return '&'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    const value = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
    return Number.isFinite(value) ? String.fromCodePoint(value) : ''
  })
}

/** Texte d'un élément riche (<si>, <is>) : concaténation des <t>, sans les indications phonétiques. */
function richText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  return [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')
}

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1]

/** « AB12 » → 27 (index de colonne à partir de 0). */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? ''
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

/** Nombre Excel → texte sans artefact binaire (12.499999999999998 → « 12.5 »). */
const cleanNumber = (value: string) => {
  const n = Number(value)
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : value
}

export function parseSheetXml(xml: string, shared: string[]): string[][] {
  const matrix: string[][] = []
  let nextRow = 0
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rowMatch[1], 'r'))
    const rowIndex = Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : nextRow
    nextRow = rowIndex + 1
    const cells: string[] = []
    let nextCol = 0
    for (const cell of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], 'r')
      const col = ref ? columnIndex(ref) : nextCol
      nextCol = col + 1
      const type = attr(cell[1], 't')
      const body = cell[2] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '')
      else if (type === 'str') value = decodeXml(v ?? '')
      else if (type === 'b') value = v === '1' ? '1' : '0'
      else if (type === 'e') value = ''
      else value = v === undefined ? '' : cleanNumber(decodeXml(v))
      while (cells.length < col) cells.push('')
      cells[col] = value
    }
    while (matrix.length < rowIndex) matrix.push([])
    matrix[rowIndex] = cells
  }
  return matrix
}

/** Chemin de la première feuille déclarée dans workbook.xml, via ses relations. */
function firstSheetPath(workbook: string | null, rels: string | null, names: string[]): string | null {
  const relId = workbook ? attr(/<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? '', 'r:id') : undefined
  if (relId && rels) {
    for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attr(rel[1], 'Id') !== relId) continue
      const target = attr(rel[1], 'Target') ?? ''
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      if (names.includes(path)) return path
    }
  }
  return names.filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0] ?? null
}

/** Classeur .xlsx (octets) → tableau brut de la première feuille. */
export async function parseXlsx(bytes: Uint8Array): Promise<RawTable> {
  if (bytes.length > XLSX_MAX_BYTES) throw new XlsxError('Fichier trop volumineux (5 Mo au plus).')
  const entries = readEntries(bytes)
  const byName = new Map(entries.map((e) => [e.name, e]))
  const read = async (name: string) => (byName.has(name) ? readEntry(bytes, byName.get(name)!) : null)
  const sheetPath = firstSheetPath(await read('xl/workbook.xml'), await read('xl/_rels/workbook.xml.rels'), [...byName.keys()])
  if (!sheetPath) throw new XlsxError('Aucune feuille trouvée dans le classeur.')
  const sharedXml = await read('xl/sharedStrings.xml')
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1])) : []
  return tableFromMatrix(parseSheetXml((await read(sheetPath)) ?? '', shared))
}
