import { describe, expect, it } from 'vitest'
import { checkMovement, isManualMovementType, parseQuantityInput, reasonRequired, toBaseDelta, type MovementInput } from './movements'

const kg = { label: 'Kilogramme', decimal_places: 3 }
const sac = { label: 'Sac', decimal_places: 0 }
const base: MovementInput = { type: 'restock', quantity: 1, sellUnit: { conversion_to_base: 1 }, unit: kg, reason: '', available: 0 }

describe('conversion d’unité', () => {
  it('convertit vers l’unité de base et inverse le signe d’une perte', () => {
    expect(toBaseDelta('restock', 2, { conversion_to_base: 50 })).toBe(100)
    expect(toBaseDelta('damage', 0.25, { conversion_to_base: 1 })).toBe(-0.25)
    expect(toBaseDelta('adjustment', -2.25, { conversion_to_base: 1 })).toBe(-2.25)
    expect(toBaseDelta('restock', 0.1 + 0.2, { conversion_to_base: 10 })).toBe(3)
  })
})

describe('saisie et validation de quantité', () => {
  it('lit une quantité à virgule', () => {
    expect(parseQuantityInput('12,5')).toBe(12.5)
    expect(parseQuantityInput(' -2,25 ')).toBe(-2.25)
    expect(parseQuantityInput('abc')).toBeNaN()
    expect(parseQuantityInput('')).toBeNaN()
  })

  it('accepte une quantité fractionnaire en kg et calcule le stock après', () => {
    expect(checkMovement({ ...base, quantity: 12.5, available: 100 })).toEqual({ ok: true, delta: 12.5, stockAfter: 112.5, statusAfter: 'ok' })
  })

  it('refuse zéro, une quantité négative hors ajustement, trop de décimales', () => {
    expect(checkMovement({ ...base, quantity: 0 }).ok).toBe(false)
    expect(checkMovement({ ...base, quantity: -1 }).ok).toBe(false)
    expect(checkMovement({ ...base, type: 'damage', quantity: -1, reason: 'Casse' }).ok).toBe(false)
    expect(checkMovement({ ...base, quantity: 1.5, unit: sac })).toMatchObject({ ok: false, message: 'L’unité « Sac » se compte uniquement en nombre entier.' })
    expect(checkMovement({ ...base, quantity: 1.2345 }).ok).toBe(false)
  })

  it('exige un motif pour un ajustement ou une perte', () => {
    expect(reasonRequired('adjustment') && reasonRequired('damage') && !reasonRequired('restock') && !reasonRequired('initial_stock')).toBe(true)
    expect(checkMovement({ ...base, type: 'adjustment', quantity: -1, reason: ' ', available: 5 })).toMatchObject({ ok: false })
    expect(checkMovement({ ...base, type: 'adjustment', quantity: -1, reason: 'Comptage', available: 5 })).toMatchObject({ ok: true, stockAfter: 4 })
  })

  it('refuse un inventaire initial si des mouvements existent déjà', () => {
    expect(checkMovement({ ...base, type: 'initial_stock', hasMovements: true }).ok).toBe(false)
    expect(checkMovement({ ...base, type: 'initial_stock', hasMovements: false }).ok).toBe(true)
  })
})

describe('statut de stock après mouvement', () => {
  it('refuse un stock négatif sauf réglage explicite', () => {
    expect(checkMovement({ ...base, type: 'damage', quantity: 6, reason: 'Inondation', available: 5 }).ok).toBe(false)
    expect(checkMovement({ ...base, type: 'damage', quantity: 6, reason: 'Inondation', available: 5, allowNegative: true }))
      .toEqual({ ok: true, delta: -6, stockAfter: -1, statusAfter: 'negative' })
  })

  it('signale la rupture quand le stock tombe à zéro', () => {
    expect(checkMovement({ ...base, type: 'damage', quantity: 5, reason: 'Casse', available: 5 })).toMatchObject({ ok: true, stockAfter: 0, statusAfter: 'out' })
  })

  it('ne reconnaît comme manuels que les quatre types autorisés', () => {
    expect(['initial_stock', 'restock', 'adjustment', 'damage'].every(isManualMovementType)).toBe(true)
    expect(['sale', 'return', 'reservation', 'release'].some(isManualMovementType)).toBe(false)
  })
})
