import { describe, expect, it } from 'vitest'
import {
  barcodeModules, barsFromModules, cameraScanSupported, checkBarcode, CODE128_PATTERNS, code128Modules, code128Values,
  ean13Modules, eanCheckDigit, isValidEan, normalizeBarcode,
} from './barcode'

describe('codes-barres', () => {
  it('normalise la saisie d’une douchette', () => {
    expect(normalizeBarcode(' 4006381 333931\r\n')).toBe('4006381333931')
    expect(normalizeBarcode('\t' + 'A'.repeat(70))).toHaveLength(64)
  })

  it('clé de contrôle EAN-13, EAN-8, UPC-A', () => {
    expect(eanCheckDigit('400638133393')).toBe(1)
    expect(isValidEan('4006381333931')).toBe(true)
    expect(isValidEan('4006381333932')).toBe(false)
    expect(isValidEan('96385074')).toBe(true)
    expect(isValidEan('036000291452')).toBe(true)
    expect(checkBarcode('4006381333932')).toEqual({ ok: false, message: 'Clé de contrôle EAN/UPC incorrecte : vérifiez le code.' })
    expect(checkBarcode('MAR-500')).toEqual({ ok: true, kind: 'other' })
    expect(checkBarcode('')).toEqual({ ok: false, message: 'Code-barres vide.' })
  })

  it('EAN-13 : 95 modules, gardes 101 / 01010 / 101', () => {
    const modules = ean13Modules('4006381333931')
    expect(modules).toHaveLength(95)
    expect(modules.slice(0, 3)).toBe('101')
    expect(modules.slice(45, 50)).toBe('01010')
    expect(modules.slice(-3)).toBe('101')
    // Premier chiffre 4 → parité LGLLGG ; deuxième chiffre 0 en L = 0001101.
    expect(modules.slice(3, 10)).toBe('0001101')
    expect(ean13Modules('036000291452')).toHaveLength(95)
    expect(() => ean13Modules('4006381333932')).toThrow()
  })

  it('Code 128 B : table cohérente, clé, longueur', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    for (const [i, pattern] of CODE128_PATTERNS.entries()) {
      expect([...pattern].reduce((s, w) => s + Number(w), 0)).toBe(i === 106 ? 13 : 11)
    }
    // « AB » : A=33, B=34 → (104 + 33×1 + 34×2) mod 103 = 205 mod 103 = 102
    expect(code128Values('AB')).toEqual([104, 33, 34, 102, 106])
    expect(code128Modules('AB')).toHaveLength(11 * 4 + 13)
    expect(() => code128Values('é')).toThrow()
  })

  it('choisit EAN-13 pour un EAN valide, sinon Code 128 ; barres regroupées', () => {
    expect(barcodeModules('4006381333931').symbology).toBe('EAN-13')
    expect(barcodeModules('MAR-500').symbology).toBe('Code 128')
    expect(barcodeModules('4006381333932').symbology).toBe('Code 128')
    expect(barsFromModules('1101001')).toEqual([{ x: 0, width: 2 }, { x: 3, width: 1 }, { x: 6, width: 1 }])
  })

  it('caméra : seulement avec BarcodeDetector, contexte sécurisé et getUserMedia', () => {
    expect(cameraScanSupported({ BarcodeDetector: function () {}, isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => {} } } })).toBe(true)
    expect(cameraScanSupported({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => {} } } })).toBe(false)
    expect(cameraScanSupported({ BarcodeDetector: function () {}, isSecureContext: false, navigator: {} })).toBe(false)
    expect(cameraScanSupported(undefined)).toBe(false)
  })
})
