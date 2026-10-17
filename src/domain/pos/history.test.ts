import { describe, expect, it } from 'vitest'
import { dayRange, formatShopDateTime, normalizeNumberSearch, paymentModes, sellerName, shopToday } from './history'
import type { ReceiptSnapshot } from './receipt'

const snapshot = (payments: ReceiptSnapshot['payments'], cashier: ReceiptSnapshot['cashier'] = { name: 'Awa' }) =>
  ({ payments, cashier } as ReceiptSnapshot)

describe('historique des ventes', () => {
  it('donne le jour courant dans le fuseau de Dakar', () => {
    expect(shopToday(new Date('2026-10-16T23:59:00Z'))).toBe('2026-10-16')
    expect(shopToday(new Date('2026-10-17T00:00:00Z'))).toBe('2026-10-17')
  })

  it('construit un intervalle de jours inclusif', () => {
    expect(dayRange('2026-10-16', '2026-10-16')).toEqual({ ok: true, from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' })
    expect(dayRange('2026-12-31', '2026-12-31')).toMatchObject({ to: '2027-01-01T00:00:00.000Z' })
  })

  it('refuse une date invalide ou un intervalle inversé', () => {
    expect(dayRange('2026-02-30', '2026-03-01')).toEqual({ ok: false, message: 'Date invalide.' })
    expect(dayRange('', '2026-03-01').ok).toBe(false)
    expect(dayRange('2026-03-02', '2026-03-01')).toEqual({ ok: false, message: 'La date de fin précède la date de début.' })
  })

  it('normalise la recherche par numéro', () => {
    expect(normalizeNumberSearch(' ticket-2026-000042 ')).toBe('TICKET-2026-000042')
    expect(normalizeNumberSearch('42%,*()')).toBe('42')
  })

  it('lit le mode de paiement et le vendeur dans l’instantané', () => {
    const mixed = snapshot([
      { method: 'cash', label: 'Espèces', amount: 1000 },
      { method: 'wave', label: 'Wave', amount: 500 },
      { method: 'cash', label: 'Espèces', amount: 1 },
    ])
    expect(paymentModes(mixed)).toBe('Espèces + Wave')
    expect(paymentModes(snapshot([]))).toBe('—')
    expect(paymentModes(null)).toBe('—')
    expect(sellerName(mixed)).toBe('Awa')
    expect(sellerName(snapshot([], { name: '  ' }))).toBe('—')
  })

  it('affiche la date à l’heure de Dakar', () => {
    expect(formatShopDateTime('2026-10-16T09:30:00Z')).toBe('16/10/2026 09:30')
    expect(formatShopDateTime('pas une date')).toBe('—')
  })
})
