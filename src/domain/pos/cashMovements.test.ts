import { describe, expect, it } from 'vitest'
import { allowedCashTypes, breakdownRows, cashierExpenseCap, checkCashMovement, type CashMovementInput } from './cashMovements'

const input = (patch: Partial<CashMovementInput> = {}): CashMovementInput => ({ type: 'expense', amount: 2000, reason: 'Achat de sachets', receiptRef: '', ...patch })

describe('mouvements de caisse', () => {
  it('types permis par rôle', () => {
    expect(allowedCashTypes('owner')).toEqual(['expense', 'cash_in', 'cash_out', 'deposit'])
    expect(allowedCashTypes('manager')).toHaveLength(4)
    expect(allowedCashTypes('cashier')).toEqual(['expense'])
    expect(allowedCashTypes('stock_keeper')).toEqual([])
    expect(allowedCashTypes(null)).toEqual([])
  })

  it('motif obligatoire, montant > 0 et entier en FCFA', () => {
    const ctx = { role: 'manager' as const, cashierCap: 0, expectedCash: 50000 }
    expect(checkCashMovement(input({ reason: ' a ' }), ctx)).toBe('Le motif est obligatoire (3 à 300 caractères).')
    expect(checkCashMovement(input({ amount: 0 }), ctx)).toBe('Le montant doit être supérieur à zéro.')
    expect(checkCashMovement(input({ amount: -5 }), ctx)).toBe('Le montant doit être supérieur à zéro.')
    expect(checkCashMovement(input({ amount: 12.5 }), ctx)).toBe('Montant entier en FCFA attendu.')
    expect(checkCashMovement(input({ receiptRef: 'x'.repeat(101) }), ctx)).toMatch(/justificatif/)
    expect(checkCashMovement(input(), ctx)).toBeNull()
  })

  it('vendeur : dépenses seulement, sous le plafond', () => {
    expect(checkCashMovement(input({ type: 'cash_out' }), { role: 'cashier', cashierCap: 5000, expectedCash: 50000 }))
      .toBe('Un vendeur ne peut enregistrer que des petites dépenses.')
    expect(checkCashMovement(input({ amount: 6000 }), { role: 'cashier', cashierCap: 5000, expectedCash: 50000 }))
      .toBe('Dépense supérieure au plafond autorisé pour un vendeur (5000).')
    expect(checkCashMovement(input(), { role: 'cashier', cashierCap: 0, expectedCash: 50000 })).toMatch(/plafond à 0/)
    expect(checkCashMovement(input({ amount: 5000 }), { role: 'cashier', cashierCap: 5000, expectedCash: 50000 })).toBeNull()
  })

  it('sortie refusée si les espèces attendues deviendraient négatives ; apport toujours possible', () => {
    const ctx = { role: 'owner' as const, cashierCap: 0, expectedCash: 1000 }
    expect(checkCashMovement(input({ type: 'deposit', amount: 1500 }), ctx)).toBe('Espèces insuffisantes en caisse pour cette sortie.')
    expect(checkCashMovement(input({ type: 'cash_in', amount: 1500 }), ctx)).toBeNull()
    expect(checkCashMovement(input({ type: 'cash_out', amount: 1000 }), ctx)).toBeNull()
  })

  it('plafond lu dans les réglages', () => {
    expect(cashierExpenseCap(5000)).toBe(5000)
    expect(cashierExpenseCap('2500')).toBe(2500)
    expect(cashierExpenseCap(undefined)).toBe(0)
    expect(cashierExpenseCap(-1)).toBe(0)
    expect(cashierExpenseCap('abc')).toBe(0)
  })

  it('ventilation : ordre stable, sens de chaque type, montants de la base', () => {
    const rows = breakdownRows({ deposit: { count: 1, amount: 20000 }, sale_cash: { count: 4, amount: 35000 }, correction: { count: 1, amount: 100 }, autre: { count: 1, amount: 1 } })
    expect(rows.map((r) => [r.type, r.direction])).toEqual([['sale_cash', 1], ['deposit', -1], ['correction', 0], ['autre', 0]])
    expect(rows[0]).toMatchObject({ label: 'Ventes en espèces', amount: 35000, count: 4 })
  })
})
