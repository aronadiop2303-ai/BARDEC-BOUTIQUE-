/**
 * Codes-barres : normalisation de la saisie (douchette USB = clavier + Entrée), contrôle EAN/UPC,
 * encodage EAN-13 et Code 128 (jeu B) en modules pour l'impression d'étiquettes. Aucune dépendance.
 */

/** Retire espaces et caractères de contrôle que certaines douchettes ajoutent ; 64 caractères au plus. */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/[\s\u0000-\u001f]/g, '').slice(0, 64)
}

/** Clé de contrôle EAN/UPC (somme pondérée 3/1 depuis la droite) des chiffres SANS la clé. */
export function eanCheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[digits.length - 1 - i])
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10
}

/** Vrai pour un EAN-8, UPC-A (12) ou EAN-13 dont la clé est correcte. */
export function isValidEan(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false
  return eanCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1])
}

export type BarcodeKind = 'ean' | 'other'

/** Un code numérique de 8, 12 ou 13 chiffres à clé fausse est probablement mal saisi. */
export function checkBarcode(code: string): { ok: true; kind: BarcodeKind } | { ok: false; message: string } {
  if (!code) return { ok: false, message: 'Code-barres vide.' }
  if (/^(\d{8}|\d{12}|\d{13})$/.test(code)) {
    return isValidEan(code) ? { ok: true, kind: 'ean' } : { ok: false, message: 'Clé de contrôle EAN/UPC incorrecte : vérifiez le code.' }
  }
  if (!/^[\x20-\x7e]+$/.test(code)) return { ok: false, message: 'Caractères non imprimables dans le code.' }
  return { ok: true, kind: 'other' }
}

// ── EAN-13 ──────────────────────────────────────────────────────────────────

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** 95 modules (1 = barre) d'un EAN-13 ; un UPC-A (12 chiffres) est codé comme EAN-13 précédé de 0. */
export function ean13Modules(code: string): string {
  const full = code.length === 12 ? `0${code}` : code
  if (!/^\d{13}$/.test(full) || !isValidEan(full)) throw new Error('EAN-13 invalide.')
  const parity = PARITY[Number(full[0])]
  let modules = '101'
  for (let i = 1; i <= 6; i += 1) modules += (parity[i - 1] === 'L' ? L : G)[Number(full[i])]
  modules += '01010'
  for (let i = 7; i <= 12; i += 1) modules += R[Number(full[i])]
  return modules + '101'
}

// ── Code 128 (jeu B : ASCII 32 à 126) ───────────────────────────────────────

/** Largeurs barre/espace des 107 symboles (106 = arrêt, 7 éléments). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/** Valeurs des symboles : départ B, données, clé (somme pondérée modulo 103), arrêt. */
export function code128Values(text: string): number[] {
  if (!text || !/^[\x20-\x7e]+$/.test(text)) throw new Error('Code 128 : caractères ASCII imprimables seulement.')
  const data = [...text].map((ch) => ch.charCodeAt(0) - 32)
  const checksum = data.reduce((sum, value, i) => sum + value * (i + 1), START_B) % 103
  return [START_B, ...data, checksum, STOP]
}

export function code128Modules(text: string): string {
  return code128Values(text).map((value) => [...CODE128_PATTERNS[value]].map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(w))).join('')).join('')
}

/** Modules du code à imprimer : EAN-13/UPC-A si valide, sinon Code 128. */
export function barcodeModules(code: string): { symbology: 'EAN-13' | 'Code 128'; modules: string } {
  if ((/^\d{13}$/.test(code) || /^\d{12}$/.test(code)) && isValidEan(code)) return { symbology: 'EAN-13', modules: ean13Modules(code) }
  return { symbology: 'Code 128', modules: code128Modules(code) }
}

/** Barres consécutives regroupées : [{ x, width }] en modules, pour un rendu SVG compact. */
export function barsFromModules(modules: string): { x: number; width: number }[] {
  const bars: { x: number; width: number }[] = []
  for (let i = 0; i < modules.length; i += 1) {
    if (modules[i] !== '1') continue
    const last = bars[bars.length - 1]
    if (last && last.x + last.width === i) last.width += 1
    else bars.push({ x: i, width: 1 })
  }
  return bars
}

/** Le navigateur peut-il lire un code par la caméra (API BarcodeDetector) ? */
export function cameraScanSupported(win: unknown = typeof window !== 'undefined' ? window : undefined): boolean {
  const w = win as { BarcodeDetector?: unknown; isSecureContext?: boolean; navigator?: { mediaDevices?: { getUserMedia?: unknown } } } | undefined
  return !!w && typeof w.BarcodeDetector === 'function' && w.isSecureContext === true && typeof w.navigator?.mediaDevices?.getUserMedia === 'function'
}
