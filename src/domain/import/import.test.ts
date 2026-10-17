import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsvMatrix, parseDelimited } from './csv'
import { applyMapping, duplicateColumns, missingRequired, normalizeLabel, suggestMapping, type ColumnMapping } from './mapping'
import { csvTemplate, TEMPLATE_HEADERS } from './template'
import { MAX_IMPORT_ROWS, parseDecimal, validateImport, type ImportContext } from './validate'
import { columnIndex, decodeXml, parseXlsx, XlsxError } from './xlsx'

const BOM = String.fromCharCode(0xfeff)

const context: ImportContext = {
  mode: 'create',
  units: [
    { id: 'unit-u', code: 'u', label: 'Pièce', decimal_places: 0 },
    { id: 'unit-m', code: 'm', label: 'Mètre', decimal_places: 2 },
    { id: 'unit-kg', code: 'kg', label: 'Kilogramme', decimal_places: 3 },
  ],
  locations: [
    { id: 'loc-1', name: 'Magasin', is_active: true },
    { id: 'loc-2', name: 'Dépôt Thiaroye', is_active: true },
    { id: 'loc-3', name: 'Ancien dépôt', is_active: false },
  ],
  existing: [{ id: 'p-old', name: 'Pince existante', sku: 'PIN-1', barcode: '6009999999999' }],
}

const preview = (csv: string, overrides: Partial<ImportContext> = {}) => {
  const table = parseDelimited(csv)
  return validateImport(applyMapping(table, suggestMapping(table.headers)), { ...context, ...overrides })
}

describe('lecture CSV', () => {
  it('détecte « ; », « , » et la tabulation', () => {
    expect(detectDelimiter('Nom;Prix\nA;1')).toBe(';')
    expect(detectDelimiter('Nom,Prix\nA,1')).toBe(',')
    expect(detectDelimiter('Nom\tPrix\nA\t1')).toBe('\t')
    expect(detectDelimiter('Nom;Prix\n"Câble 2,5 mm²";400')).toBe(';')
  })

  it('gère guillemets, guillemets doublés, retours à la ligne, CRLF et marque UTF-8', () => {
    const text = `${BOM}Nom;Note\r\n"Vis ""6 x 40""";"ligne 1\nligne 2"\r\n`
    expect(parseCsvMatrix(text, ';')).toEqual([['Nom', 'Note'], ['Vis "6 x 40"', 'ligne 1\nligne 2']])
  })

  it('ignore les lignes vides et garde le numéro de ligne du fichier', () => {
    const table = parseDelimited('\nNom;Prix\n\nMarteau;5000\n ; \nScie;7000\n')
    expect(table.headers).toEqual(['Nom', 'Prix'])
    expect(table.rows).toEqual([['Marteau', '5000'], ['Scie', '7000']])
    expect(table.lines).toEqual([4, 6])
  })

  it('conserve les accents (UTF-8)', () => {
    const table = parseDelimited('Nom;Catégorie\nÉquerre;Électricité\nTôle ondulée;Quincaillerie générale')
    expect(table.rows[0]).toEqual(['Équerre', 'Électricité'])
    expect(table.rows[1][0]).toBe('Tôle ondulée')
  })
})

describe('nombres', () => {
  it('accepte la virgule décimale et les séparateurs de milliers', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal('1 234,50')).toBe(1234.5)
    expect(parseDecimal('1.234,50')).toBe(1234.5)
    expect(parseDecimal('1,234.50')).toBe(1234.5)
    expect(parseDecimal('1.234.567')).toBe(1234567)
    expect(parseDecimal(`5${String.fromCharCode(0x202f)}000 FCFA`)).toBe(5000)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('douze')).toBeNaN()
  })
})

describe('mapping des colonnes', () => {
  it('reconnaît les en-têtes avec ou sans accents', () => {
    expect(normalizeLabel('Prix d’achat (FCFA)')).toBe('prix d achat fcfa')
    const mapping = suggestMapping(['Désignation', 'Référence', 'Code-barres', 'Famille', 'Unité', 'Prix de vente', 'Prix d’achat', 'Qté', 'Dépôt'])
    expect(mapping).toEqual({ name: 0, sku: 1, barcode: 2, category: 3, unit: 4, price: 5, cost: 6, initial_stock: 7, location: 8 })
  })

  it('reconnaît le modèle téléchargeable et signale les champs obligatoires manquants', () => {
    const mapping = suggestMapping(TEMPLATE_HEADERS)
    expect(Object.values(mapping)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(missingRequired({ ...mapping, price: null })).toEqual(['price'])
    expect(duplicateColumns({ ...mapping, sku: 0 } as ColumnMapping)).toEqual([0])
  })

  it('le modèle CSV est en UTF-8 avec « ; » et se relit sans erreur', () => {
    const template = csvTemplate()
    expect(template.startsWith(BOM)).toBe(true)
    const result = preview(template)
    expect(result.errorCount).toBe(0)
    expect(result.rows[1].payload).toMatchObject({ name: 'Câble rigide 2,5 mm²', unit_id: 'unit-m', initial_stock: 150.5, category: 'Électricité' })
  })
})

describe('validation ligne par ligne', () => {
  it('produit une ligne prête pour la base', () => {
    const result = preview('Nom;SKU;Unité;Prix;Prix d’achat;Stock;Emplacement\nCâble 2,5 mm²;CAB-25;mètre;400;250;12,5;dépôt thiaroye')
    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload).toEqual({
      line: 2, action: 'create', product_id: null, name: 'Câble 2,5 mm²', sku: 'CAB-25', barcode: null, category: null,
      unit_id: 'unit-m', price: 400, cost: 250, initial_stock: 12.5, location_id: 'loc-2',
    })
  })

  it('signale les doublons de SKU et de code-barres dans le fichier, sans tenir compte de la casse du SKU', () => {
    const result = preview('Nom;SKU;Code-barres;Prix\nA;ref-1;111;10\nB;REF-1;222;10\nC;ref-2;111;10')
    expect(result.rows[0].errors).toContain('SKU « ref-1 » en double dans le fichier (lignes 2, 3).')
    expect(result.rows[1].errors).toContain('SKU « REF-1 » en double dans le fichier (lignes 2, 3).')
    expect(result.rows[2].errors).toContain('Code-barres « 111 » en double dans le fichier (lignes 2, 4).')
    expect(result.errorCount).toBe(3)
  })

  it('mode création : SKU ou code-barres déjà en base = erreur', () => {
    const result = preview('Nom;SKU;Code-barres;Prix\nPince;pin-1;;10\nAutre;X-1;6009999999999;10')
    expect(result.rows[0].errors).toContain('SKU « pin-1 » déjà utilisé par « Pince existante ».')
    expect(result.rows[1].errors).toContain('Code-barres « 6009999999999 » déjà utilisé par « Pince existante ».')
  })

  it('mode mise à jour : SKU connu = mise à jour, stock initial refusé', () => {
    const ok = preview('Nom;SKU;Code-barres;Prix\nPince renforcée;PIN-1;6009999999999;2500', { mode: 'upsert' })
    expect(ok.rows[0].payload).toMatchObject({ action: 'update', product_id: 'p-old', unit_id: null, price: 2500 })
    const refused = preview('Nom;SKU;Prix;Stock\nPince;PIN-1;2500;3', { mode: 'upsert' })
    expect(refused.rows[0].errors).toContain('Stock initial impossible pour un produit existant : utilisez un ajustement de stock.')
  })

  it('prix : obligatoire, entier, positif ou nul', () => {
    const result = preview('Nom;Prix;Prix d’achat\nA;;\nB;-5;\nC;12,5;\nD;0;abc\nE;0;')
    expect(result.rows[0].errors).toContain('Prix de vente obligatoire.')
    expect(result.rows[1].errors).toContain('Prix de vente négatif : il doit être positif ou nul.')
    expect(result.rows[2].errors).toContain('Prix de vente : montant entier en FCFA attendu (« 12,5 »).')
    expect(result.rows[3].errors).toContain('Prix d’achat illisible : « abc ».')
    expect(result.rows[4].errors).toEqual([])
  })

  it('stock : entier pour la pièce, décimales limitées par l’unité', () => {
    const result = preview('Nom;Unité;Prix;Stock\nMarteau;u;10;2,5\nCâble;m;10;1,255\nClous;kg;10;0,750\nVis;u;10;0')
    expect(result.rows[0].errors).toContain('Stock initial : nombre entier attendu pour l’unité « Pièce ».')
    expect(result.rows[1].errors).toContain('Stock initial : 2 décimale(s) au plus pour l’unité « Mètre ».')
    expect(result.rows[2].payload).toMatchObject({ initial_stock: 0.75, location_id: 'loc-1' })
    expect(result.rows[2].warnings).toContain('Stock placé dans l’emplacement par défaut « Magasin ».')
    expect(result.rows[3].payload).toMatchObject({ initial_stock: null, location_id: null })
  })

  it('unité et emplacement inconnus ou désactivés', () => {
    const result = preview('Nom;Unité;Prix;Stock;Emplacement\nA;sac;10;1;\nB;u;10;1;Ancien dépôt')
    expect(result.rows[0].errors[0]).toMatch(/^Unité inconnue : « sac »/)
    expect(result.rows[1].errors).toContain('Emplacement inconnu ou désactivé : « Ancien dépôt ».')
  })

  it('signale un import de plus de 1 000 lignes', () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i};10`)
    expect(preview(`Nom;Prix\n${lines.join('\n')}`).tooMany).toBe(true)
  })
})

// ── Excel ────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Archive ZIP minimale (CRC non vérifié par le lecteur). */
async function makeZip(files: Record<string, string>, compress = true): Promise<Uint8Array> {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const raw = encoder.encode(content)
    const data = compress ? await deflate(raw) : raw
    const nameBytes = encoder.encode(name)
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, compress ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, compress ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...locals, ...centrals, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of all) { out.set(part, at); at += part.length }
  return out
}

const workbook = {
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Produits" sheetId="1" r:id="rId7"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Target="worksheets/produits.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Nom</t></si><si><t>Prix de vente</t></si><si><r><t>Câble </t></r><r><t>2,5 mm²</t></r></si><si><t>Stock</t></si><si><t>Tôle &amp; vis</t></si></sst>',
  'xl/worksheets/produits.xml': '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>400</v></c><c r="C2"><v>12.499999999999998</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>Équerre</t></is></c><c r="C4"><f>1+1</f><v>2</v></c></row>'
    + '<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" t="str"><v>7000</v></c></row>'
    + '</sheetData></worksheet>',
}

describe('lecture Excel .xlsx', () => {
  it('lit la première feuille (textes partagés, en ligne, nombres, formules) avec la compression deflate', async () => {
    const table = await parseXlsx(await makeZip(workbook))
    expect(table.headers).toEqual(['Nom', 'Prix de vente', 'Stock'])
    expect(table.rows).toEqual([['Câble 2,5 mm²', '400', '12.5'], ['Équerre', '', '2'], ['Tôle & vis', '7000', '']])
    expect(table.lines).toEqual([2, 4, 5])
  })

  it('lit aussi une archive sans compression', async () => {
    const table = await parseXlsx(await makeZip(workbook, false))
    expect(table.rows[0][0]).toBe('Câble 2,5 mm²')
  })

  it('refuse un fichier qui n’est pas un classeur', async () => {
    await expect(parseXlsx(encoder.encode('Nom;Prix'))).rejects.toBeInstanceOf(XlsxError)
  })

  it('outils XML', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('AB12')).toBe(27)
    expect(decodeXml('&lt;a&gt; &#233;&#x00E8; &quot;')).toBe('<a> éè "')
  })
})
