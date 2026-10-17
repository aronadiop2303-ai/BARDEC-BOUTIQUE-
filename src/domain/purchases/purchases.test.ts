import { describe, expect, it } from 'vitest'
import { buildPurchaseLines, buildReceiptLines, weightedAverageCost, type ReceivableLine } from './purchases'

describe('coût moyen pondéré', () => {
  it('pondère le stock existant et la réception', () => {
    // 10 sacs à 4 000 + 30 sacs à 4 400 → 4 300
    expect(weightedAverageCost(10, 4000, 30, 4400)).toBe(4300)
    expect(weightedAverageCost(3, 1000, 3, 1001)).toBe(1000.5)
  })
  it('sans coût connu ou sans stock : coût reçu', () => {
    expect(weightedAverageCost(10, null, 5, 2500)).toBe(2500)
    expect(weightedAverageCost(0, 3000, 5, 2500)).toBe(2500)
    expect(weightedAverageCost(-2, 3000, 5, 2500)).toBe(2500)
  })
  it('coût par unité de base : rouleau de 100 m à 35 000 → 350 le mètre', () => {
    expect(weightedAverageCost(0, null, 100, 35000 / 100)).toBe(350)
  })
})

describe('bon de commande', () => {
  it('quantités, décimales, coût entier, total indicatif', () => {
    expect(buildPurchaseLines([])).toEqual({ ok: false, message: 'Ajoutez au moins un produit.' })
    expect(buildPurchaseLines([{ productId: 'p', productName: 'Ciment', quantity: '2,5', unitCost: '4000', decimals: 0 }]))
      .toEqual({ ok: false, message: '« Ciment » : 0 décimale(s) au plus.' })
    expect(buildPurchaseLines([{ productId: 'p', productName: 'Ciment', quantity: '10', unitCost: '4000,5', decimals: 0 }]).ok).toBe(false)
    expect(buildPurchaseLines([
      { productId: 'p', productName: 'Ciment', quantity: '10', unitCost: '4 000', decimals: 0 },
      { productId: 'q', productName: 'Câble', quantity: '12,5', unitCost: '300', decimals: 2 },
    ])).toEqual({ ok: true, lines: [{ product_id: 'p', quantity: 10, unit_cost: 4000 }, { product_id: 'q', quantity: 12.5, unit_cost: 300 }], indicativeTotal: 43750 })
  })
})

describe('réception', () => {
  const lines: ReceivableLine[] = [
    { line_id: 'l1', product_id: 'p', product_name: 'Ciment', unit_label: 'Sac', decimal_places: 0, quantity_ordered: 40, quantity_received: 30, quantity_remaining: 10 },
    { line_id: 'l2', product_id: 'q', product_name: 'Câble', unit_label: 'Mètre', decimal_places: 2, quantity_ordered: 100, quantity_received: 0, quantity_remaining: 100 },
  ]
  it('limite au restant à recevoir, emplacement obligatoire, lignes vides ignorées', () => {
    expect(buildReceiptLines(lines, { l1: '5' }, '')).toEqual({ ok: false, message: 'Choisissez l’emplacement de réception.' })
    expect(buildReceiptLines(lines, { l1: '11' }, 'loc')).toEqual({ ok: false, message: '« Ciment » : au plus 10 restant à recevoir.' })
    expect(buildReceiptLines(lines, { l1: '', l2: '' }, 'loc')).toEqual({ ok: false, message: 'Indiquez au moins une quantité reçue.' })
    expect(buildReceiptLines(lines, { l1: '10', l2: '50,25' }, 'loc')).toEqual({
      ok: true, lines: [{ line_id: 'l1', quantity: 10, location_id: 'loc' }, { line_id: 'l2', quantity: 50.25, location_id: 'loc' }],
    })
  })
})
