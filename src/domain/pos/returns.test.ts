import { describe, expect, it } from 'vitest'
import { buildReturnLines, checkReturnReason, returnAllowed, type ReturnableLine } from './returns'

const lines: ReturnableLine[] = [
  { order_item_id: 'i1', product_id: 'p1', product_name: 'Marteau', unit_label: 'Pièce', decimal_places: 0, quantity_sold: 3, quantity_returned: 1, quantity_returnable: 2, unit_refund: 4500 },
  { order_item_id: 'i2', product_id: 'p2', product_name: 'Câble', unit_label: 'Mètre', decimal_places: 2, quantity_sold: 10, quantity_returned: 0, quantity_returnable: 10, unit_refund: 360 },
]

describe('retours', () => {
  it('limite aux quantités vendues moins les retours déjà faits', () => {
    expect(buildReturnLines(lines, [{ order_item_id: 'i1', quantity: '3', disposition: 'restock' }]))
      .toEqual({ ok: false, message: '« Marteau » : au plus 2 à retourner (vendu 3, déjà retourné 1).' })
    expect(buildReturnLines(lines, [{ order_item_id: 'i1', quantity: '2', disposition: 'restock' }]))
      .toEqual({ ok: true, lines: [{ order_item_id: 'i1', quantity: 2, disposition: 'restock' }], preview: 9000 })
  })

  it('décimales de l’unité, virgule décimale, lignes à zéro ignorées, casse', () => {
    expect(buildReturnLines(lines, [{ order_item_id: 'i1', quantity: '1,5', disposition: 'restock' }]))
      .toEqual({ ok: false, message: '« Marteau » : 0 décimale(s) au plus.' })
    const result = buildReturnLines(lines, [
      { order_item_id: 'i1', quantity: '', disposition: 'restock' },
      { order_item_id: 'i2', quantity: '2,5', disposition: 'damage' },
    ])
    expect(result).toEqual({ ok: true, lines: [{ order_item_id: 'i2', quantity: 2.5, disposition: 'damage' }], preview: 900 })
    expect(buildReturnLines(lines, [{ order_item_id: 'i1', quantity: '0', disposition: 'restock' }]))
      .toEqual({ ok: false, message: 'Indiquez au moins une quantité à retourner.' })
    expect(buildReturnLines(lines, [{ order_item_id: 'i2', quantity: '-1', disposition: 'restock' }]).ok).toBe(false)
  })

  it('motif obligatoire et plafond du vendeur', () => {
    expect(checkReturnReason('ab')).toMatch(/obligatoire/)
    expect(checkReturnReason('Article défectueux')).toBeNull()
    expect(returnAllowed('manager', 1_000_000, 0)).toBeNull()
    expect(returnAllowed('cashier', 5000, 10000)).toBeNull()
    expect(returnAllowed('cashier', 15000, 10000)).toMatch(/plafond autorisé pour un vendeur \(10000\)/)
    expect(returnAllowed('cashier', 1, 0)).toMatch(/plafond à 0/)
    expect(returnAllowed('stock_keeper', 1, 100)).toBe('Retour non autorisé pour votre rôle.')
  })
})
