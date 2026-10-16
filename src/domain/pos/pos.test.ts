import { describe, expect, it } from 'vitest'
import type { PriceTier } from '../hardware/pricing'
import type { SellUnit } from '../hardware/units'
import { formatDocumentNumber, isContinuous, parseDocumentNumber } from './numbering'
import { checkPayments } from './payments'
import { legalMentions } from './receipt'
import { checkDiscount, computeSaleLine, computeTotals, maxDiscountPercent } from './sale'

const metre: SellUnit = { unit_id: 'm', conversion_to_base: 1, min_sale_quantity: 0.5, quantity_step: 0.5, is_default: true }
const rouleau: SellUnit = { unit_id: 'rl', conversion_to_base: 100, min_sale_quantity: 1, quantity_step: 1, is_default: false }
const piece: SellUnit = { unit_id: 'u', conversion_to_base: 1, min_sale_quantity: 1, quantity_step: 1, is_default: true }
const tier = (unit_id: string | null, min_quantity: number, unit_price: number): PriceTier => ({ unit_id, min_quantity, unit_price, valid_from: null, valid_until: null })

describe('calcul de ligne', () => {
  it('accepte une quantité fractionnaire et arrondit au franc', () => {
    const result = computeSaleLine({ basePrice: 333, sellUnit: metre, unit: { label: 'Mètre', decimal_places: 2 }, tiers: [], quantity: 2.5 })
    expect(result).toMatchObject({ ok: true, line: { quantity: 2.5, baseQuantity: 2.5, unitPrice: 333, gross: 833, total: 833 } })
  })

  it('refuse une quantité hors pas ou un entier attendu', () => {
    expect(computeSaleLine({ basePrice: 350, sellUnit: metre, unit: { label: 'Mètre', decimal_places: 2 }, tiers: [], quantity: 2.3 }).ok).toBe(false)
    expect(computeSaleLine({ basePrice: 5000, sellUnit: piece, unit: { label: 'Pièce', decimal_places: 0 }, tiers: [], quantity: 1.5 }).ok).toBe(false)
    expect(computeSaleLine({ basePrice: 5000, sellUnit: piece, unit: { label: 'Pièce', decimal_places: 0 }, tiers: [], quantity: 0 }).ok).toBe(false)
  })

  it('convertit l’unité de vente : prix de base × conversion, quantité en unité de base', () => {
    const result = computeSaleLine({ basePrice: 350, sellUnit: rouleau, unit: { label: 'Rouleau', decimal_places: 0 }, tiers: [], quantity: 2 })
    expect(result).toMatchObject({ ok: true, line: { baseQuantity: 200, unitPrice: 35000, gross: 70000 } })
  })

  it('applique le palier atteint de la même unité, y compris le palier sans unité pour l’unité de base', () => {
    const tiers = [tier('u', 10, 4500), tier('u', 50, 4200), tier(null, 20, 4400)]
    const at = (quantity: number) => computeSaleLine({ basePrice: 5000, sellUnit: piece, unit: { label: 'Pièce', decimal_places: 0 }, tiers, quantity })
    expect(at(9)).toMatchObject({ line: { unitPrice: 5000, tier: null } })
    expect(at(10)).toMatchObject({ line: { unitPrice: 4500 } })
    expect(at(20)).toMatchObject({ line: { unitPrice: 4400 } })
    expect(at(50)).toMatchObject({ line: { unitPrice: 4200, gross: 210000 } })
    // Un palier sans unité ne s'applique pas à une unité convertie (rouleau).
    expect(computeSaleLine({ basePrice: 350, sellUnit: rouleau, unit: { label: 'Rouleau', decimal_places: 0 }, tiers: [tier(null, 1, 1)], quantity: 1 }))
      .toMatchObject({ line: { unitPrice: 35000 } })
  })

  it('refuse une remise de ligne négative, supérieure au montant ou non arrondie', () => {
    const base = { basePrice: 5000, sellUnit: piece, unit: { label: 'Pièce', decimal_places: 0 }, tiers: [], quantity: 1 }
    expect(computeSaleLine({ ...base, lineDiscount: 500 })).toMatchObject({ line: { total: 4500 } })
    for (const lineDiscount of [-1, 5001, 10.5]) expect(computeSaleLine({ ...base, lineDiscount }).ok).toBe(false)
  })
})

describe('totaux et remises', () => {
  const lines = [{ gross: 10000, lineDiscount: 0 }, { gross: 875, lineDiscount: 75 }]

  it('additionne et applique une remise en pourcentage arrondie', () => {
    expect(computeTotals(lines, null)).toEqual({ ok: true, totals: { subtotal: 10875, lineDiscounts: 75, orderDiscount: 0, discountTotal: 75, grandTotal: 10800 } })
    expect(computeTotals(lines, { type: 'percent', value: 5, reason: 'x' })).toMatchObject({ totals: { orderDiscount: 540, grandTotal: 10260 } })
  })

  it('refuse une remise supérieure au total ou à 100 %', () => {
    expect(computeTotals(lines, { type: 'amount', value: 20000, reason: 'x' }).ok).toBe(false)
    expect(computeTotals(lines, { type: 'percent', value: 120, reason: 'x' }).ok).toBe(false)
    expect(computeTotals(lines, { type: 'amount', value: 10.5, reason: 'x' }).ok).toBe(false)
  })

  it('limite la remise selon le rôle et exige un motif', () => {
    expect(maxDiscountPercent('owner', 0)).toBe(100)
    expect(maxDiscountPercent('admin', null)).toBe(100)
    expect(maxDiscountPercent('editor', undefined)).toBe(0)
    expect(maxDiscountPercent('editor', '10')).toBe(10)
    expect(maxDiscountPercent('editor', 500)).toBe(100)
    expect(maxDiscountPercent('viewer', 50)).toBe(0)
    const totals = { subtotal: 10000, lineDiscounts: 0, orderDiscount: 1000, discountTotal: 1000, grandTotal: 9000 }
    expect(checkDiscount(totals, 10, '')).toMatch(/motif/)
    expect(checkDiscount(totals, 5, 'Client fidèle')).toMatch(/limite/)
    expect(checkDiscount(totals, 10, 'Client fidèle')).toBeNull()
  })
})

describe('paiements et monnaie', () => {
  it('rend la monnaie sur les espèces', () => {
    expect(checkPayments(10000, [{ method: 'cash', amount: 15000 }])).toEqual({ ok: true, tendered: 15000, change: 5000, cashNet: 10000, nonCash: 0 })
  })

  it('accepte un paiement mixte exact et refuse un paiement insuffisant', () => {
    expect(checkPayments(10000, [{ method: 'wave', amount: 6000 }, { method: 'cash', amount: 5000 }])).toMatchObject({ ok: true, change: 1000, cashNet: 4000 })
    const short = checkPayments(10000, [{ method: 'cash', amount: 9000 }])
    expect(short).toMatchObject({ ok: false })
    expect(short.ok ? '' : short.message).toBe('Paiement insuffisant : il manque 1 000 FCFA.')
  })

  it('refuse un excédent hors espèces, un montant non arrondi ou nul', () => {
    expect(checkPayments(10000, [{ method: 'orange_money', amount: 12000 }]).ok).toBe(false)
    expect(checkPayments(10000, [{ method: 'cash', amount: 10000.5 }]).ok).toBe(false)
    expect(checkPayments(10000, [{ method: 'card', amount: 0 }]).ok).toBe(false)
  })

  it('exige un client pour un crédit', () => {
    expect(checkPayments(10000, [{ method: 'credit', amount: 10000 }]).ok).toBe(false)
    expect(checkPayments(10000, [{ method: 'credit', amount: 10000 }], { hasCustomer: true })).toMatchObject({ ok: true, change: 0 })
  })
})

describe('numérotation', () => {
  it('formate et relit un numéro continu', () => {
    expect(formatDocumentNumber('receipt', 2026, 1)).toBe('TICKET-2026-000001')
    expect(formatDocumentNumber('invoice', 2026, 1234567)).toBe('FACT-2026-1234567')
    expect(parseDocumentNumber('TICKET-2026-000042')).toEqual({ prefix: 'TICKET', year: 2026, sequence: 42 })
    expect(parseDocumentNumber('B-ABC')).toBeNull()
    expect(() => formatDocumentNumber('receipt', 2026, 0)).toThrow()
  })

  it('détecte un trou ou un doublon', () => {
    expect(isContinuous(['TICKET-2026-000001', 'TICKET-2026-000002', 'TICKET-2026-000003'])).toBe(true)
    expect(isContinuous(['TICKET-2026-000001', 'TICKET-2026-000003'])).toBe(false)
    expect(isContinuous(['TICKET-2026-000001', 'TICKET-2026-000001'])).toBe(false)
  })
})

describe('mentions légales', () => {
  it('affiche seulement les mentions renseignées, TVA comprise si présente', () => {
    expect(legalMentions({ ninea: '0012345', rccm: '', vat_number: '  ' })).toEqual([{ label: 'NINEA', value: '0012345' }])
    expect(legalMentions({ vat_number: 'SN123' })).toEqual([{ label: 'N° TVA', value: 'SN123' }])
    expect(legalMentions(undefined)).toEqual([])
  })
})
