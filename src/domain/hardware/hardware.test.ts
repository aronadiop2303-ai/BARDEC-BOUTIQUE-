import { describe, expect, it } from 'vitest'
import { computeMargin, formatRate } from './margin'
import { formatMoney, parseMoney, roundMoney } from './money'
import { findDuplicateTier, indicativeUnitPrice, pickPriceTier, tierLabel, validatePriceTier, type PriceTier } from './pricing'
import { aggregateStock, stockStatus, totalForProduct } from './stock'
import { STARTER_FAMILIES, STARTER_UNITS } from './starter'
import { baseSellUnit, checkQuantity, formatQuantity, fromBaseQuantity, toBaseQuantity, validateSellUnit } from './units'

describe('XOF', () => {
  it('formate sans décimale avec le libellé FCFA', () => {
    expect(formatMoney(12500)).toBe('12 500 FCFA')
    expect(formatMoney(1250.6)).toBe('1 251 FCFA')
    expect(formatMoney(0)).toBe('0 FCFA')
  })

  it('arrondit à l’unité', () => {
    expect(roundMoney(99.5)).toBe(100)
    expect(roundMoney(10.255, 'EUR')).toBe(10.26)
  })

  it('lit une saisie et refuse les centimes en XOF', () => {
    expect(parseMoney('12 500')).toBe(12500)
    expect(parseMoney('4500 FCFA')).toBe(4500)
    expect(parseMoney('12,5')).toBeNull()
    expect(parseMoney('-3')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('12,5', 'EUR')).toBe(12.5)
  })
})

describe('unités et conversions', () => {
  const rouleau = { conversion_to_base: 100, min_sale_quantity: 1, quantity_step: 1 }
  const metre = { conversion_to_base: 1, min_sale_quantity: 0.5, quantity_step: 0.5 }

  it('convertit vers et depuis l’unité de base', () => {
    expect(toBaseQuantity(2, rouleau)).toBe(200)
    expect(fromBaseQuantity(250, rouleau)).toBe(2.5)
    expect(toBaseQuantity(3, { conversion_to_base: 12 })).toBe(36) // carton de 12 pièces
    expect(toBaseQuantity(0.1 + 0.2, { conversion_to_base: 1 })).toBe(0.3)
  })

  it('trouve l’unité de base par convention (conversion = 1, unique)', () => {
    expect(baseSellUnit([rouleau, metre])).toBe(metre)
    expect(baseSellUnit([rouleau])).toBeNull()
    expect(baseSellUnit([metre, { ...metre }])).toBeNull()
  })

  it('applique minimum, pas et décimales', () => {
    const unitM = { label: 'Mètre', decimal_places: 2 }
    expect(checkQuantity(2.5, metre, unitM)).toEqual({ ok: true, quantity: 2.5 })
    expect(checkQuantity(0.25, metre, unitM)).toMatchObject({ ok: false, message: 'Minimum de vente : 0,5 Mètre.' })
    expect(checkQuantity(2.3, metre, unitM)).toMatchObject({ ok: false })
    expect(checkQuantity(0.1 + 0.2, { min_sale_quantity: 0.1, quantity_step: 0.1 }, unitM)).toMatchObject({ ok: true })
    expect(checkQuantity(1.5, rouleau, { label: 'Rouleau', decimal_places: 0 })).toMatchObject({
      ok: false, message: 'L’unité « Rouleau » se vend uniquement en nombre entier.',
    })
    expect(checkQuantity(0, metre, unitM)).toMatchObject({ ok: false })
    expect(checkQuantity(Number.NaN, metre, unitM)).toMatchObject({ ok: false })
  })

  it('valide une unité de vente comme les contraintes SQL', () => {
    expect(validateSellUnit(rouleau)).toBeNull()
    expect(validateSellUnit({ ...rouleau, conversion_to_base: 0 })).toContain('conversion')
    expect(validateSellUnit({ ...rouleau, quantity_step: -1 })).toContain('pas')
  })

  it('formate les quantités à la française', () => {
    expect(formatQuantity(2.5)).toBe('2,5')
    expect(formatQuantity(1000)).toBe('1 000')
  })
})

describe('paliers de prix', () => {
  const tiers: PriceTier[] = [
    { unit_id: 'sac', min_quantity: 1, unit_price: 4800, valid_from: null, valid_until: null },
    { unit_id: 'sac', min_quantity: 10, unit_price: 4600, valid_from: null, valid_until: null },
    { unit_id: 'sac', min_quantity: 50, unit_price: 4400, valid_from: null, valid_until: null },
    { unit_id: 'sac', min_quantity: 100, unit_price: 4000, valid_from: '2026-11-01', valid_until: null },
    { unit_id: null, min_quantity: 1000, unit_price: 90, valid_from: null, valid_until: null },
  ]
  const now = new Date('2026-10-15T12:00:00Z')

  it('choisit le palier le plus haut atteint, pour la bonne unité', () => {
    expect(pickPriceTier(tiers, 'sac', 1, now)?.unit_price).toBe(4800)
    expect(pickPriceTier(tiers, 'sac', 9, now)?.unit_price).toBe(4800)
    expect(pickPriceTier(tiers, 'sac', 10, now)?.unit_price).toBe(4600)
    expect(pickPriceTier(tiers, 'sac', 75, now)?.unit_price).toBe(4400)
    expect(pickPriceTier(tiers, 'sac', 0.5, now)).toBeNull()
    expect(pickPriceTier(tiers, null, 1000, now)?.unit_price).toBe(90)
  })

  it('ignore un palier hors période de validité', () => {
    expect(pickPriceTier(tiers, 'sac', 150, now)?.unit_price).toBe(4400)
    expect(pickPriceTier(tiers, 'sac', 150, new Date('2026-11-02'))?.unit_price).toBe(4000)
  })

  it('calcule un prix indicatif : palier sinon prix de base × conversion', () => {
    expect(indicativeUnitPrice({ basePrice: 100, conversionToBase: 50, tiers, unitId: 'sac', quantity: 12, at: now }))
      .toMatchObject({ unitPrice: 4600 })
    expect(indicativeUnitPrice({ basePrice: 100, conversionToBase: 50, tiers: [], unitId: 'sac', quantity: 1, at: now }))
      .toEqual({ unitPrice: 5000, tier: null })
  })

  it('nomme et valide les paliers', () => {
    expect([0, 1, 2, 3].map(tierLabel)).toEqual(['Détail', 'Demi-gros', 'Gros', 'Palier 4'])
    expect(validatePriceTier({ min_quantity: 0, unit_price: 1, valid_from: null, valid_until: null })).toContain('quantité')
    expect(validatePriceTier({ min_quantity: 1, unit_price: -1, valid_from: null, valid_until: null })).toContain('prix')
    expect(validatePriceTier({ min_quantity: 1, unit_price: 1, valid_from: '2026-02-01', valid_until: '2026-01-01' })).toContain('fin')
    expect(findDuplicateTier([{ unit_id: 'a', min_quantity: 1 }, { unit_id: 'a', min_quantity: 10 }])).toBeNull()
    expect(findDuplicateTier([{ unit_id: 'a', min_quantity: 1 }, { unit_id: 'b', min_quantity: 1 }, { unit_id: 'a', min_quantity: 1 }])).toBe(2)
  })
})

describe('marge', () => {
  it('reste inconnue sans coût (aucun coût inventé)', () => {
    expect(computeMargin(5000, null)).toBeNull()
    expect(computeMargin(5000, undefined)).toBeNull()
    expect(computeMargin(5000, -1)).toBeNull()
  })

  it('calcule montant, taux de marge et taux de marque', () => {
    expect(computeMargin(5000, 4000)).toEqual({ amount: 1000, rateOnPrice: 0.2, markupOnCost: 0.25 })
    expect(computeMargin(0, 100)).toMatchObject({ amount: -100, rateOnPrice: null })
    expect(computeMargin(100, 0)).toMatchObject({ markupOnCost: null })
    expect(formatRate(0.2)).toBe('20 %')
    expect(formatRate(null)).toBe('—')
  })
})

describe('stock', () => {
  const rows = [
    { product_id: 'ciment', stock_location_id: 'magasin', quantity_delta: '100' },
    { product_id: 'ciment', stock_location_id: 'magasin', quantity_delta: -12 },
    { product_id: 'ciment', stock_location_id: 'depot', quantity_delta: 200 },
    { product_id: 'cable', stock_location_id: 'magasin', quantity_delta: 0.1 },
    { product_id: 'cable', stock_location_id: 'magasin', quantity_delta: 0.2 },
    { product_id: null, stock_location_id: 'magasin', quantity_delta: 5 },
  ]

  it('agrège le registre par produit et emplacement', () => {
    const levels = aggregateStock(rows)
    expect(levels).toContainEqual({ productId: 'ciment', locationId: 'magasin', quantity: 88 })
    expect(levels).toContainEqual({ productId: 'ciment', locationId: 'depot', quantity: 200 })
    expect(levels).toContainEqual({ productId: 'cable', locationId: 'magasin', quantity: 0.3 })
    expect(levels).toHaveLength(3)
    expect(totalForProduct(levels, 'ciment')).toBe(288)
    expect(totalForProduct(levels, 'inconnu')).toBe(0)
  })

  it('donne un statut honnête', () => {
    expect(stockStatus(5, { tracked: false })).toBe('untracked')
    expect(stockStatus(-2, { tracked: true })).toBe('negative')
    expect(stockStatus(0, { tracked: true })).toBe('out')
    expect(stockStatus(3, { tracked: true, minimum: 5 })).toBe('low')
    expect(stockStatus(3, { tracked: true })).toBe('ok')
  })
})

describe('données de départ', () => {
  it('respectent les contraintes SQL', () => {
    for (const unit of STARTER_UNITS) {
      expect(unit.code).toMatch(/^[a-z][a-z0-9_-]{0,23}$/)
      expect(unit.decimal_places).toBeGreaterThanOrEqual(0)
      expect(unit.decimal_places).toBeLessThanOrEqual(3)
    }
    for (const family of STARTER_FAMILIES) expect(family.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(new Set(STARTER_UNITS.map((u) => u.code)).size).toBe(STARTER_UNITS.length)
    expect(new Set(STARTER_FAMILIES.map((f) => f.slug)).size).toBe(STARTER_FAMILIES.length)
  })
})
