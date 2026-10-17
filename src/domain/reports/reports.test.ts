import { describe, expect, it } from 'vitest'
import { parseDelimited } from '../import/csv'
import { csvNumber, marginRate, periodLabel, presetRange, toCsv } from './reports'

describe('rapports', () => {
  it('export CSV : UTF-8, « ; », virgule décimale, échappement, relu par le lecteur d’import', () => {
    const csv = toCsv(
      [{ name: 'Câble 2,5 mm²', qty: 12.5, total: 5000 }, { name: 'Vis "6x40"', qty: 3, total: null }],
      [{ key: 'name', label: 'Produit' }, { key: 'qty', label: 'Quantité', kind: 'number' }, { key: 'total', label: 'Total', kind: 'number' }],
    )
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('Produit;Quantité;Total\r\n')
    expect(csv).toContain('Câble 2,5 mm²;12,5;5000\r\n')
    expect(csv).toContain('"Vis ""6x40""";3;\r\n')
    expect(parseDelimited(csv).rows).toEqual([['Câble 2,5 mm²', '12,5', '5000'], ['Vis "6x40"', '3', '']])
    expect(csvNumber('abc')).toBe('')
  })

  it('intervalles prédéfinis à Dakar', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    expect(presetRange('today', now)).toEqual({ from: '2026-03-10', to: '2026-03-10' })
    expect(presetRange('last7', now)).toEqual({ from: '2026-03-04', to: '2026-03-10' })
    expect(presetRange('month', now)).toEqual({ from: '2026-03-01', to: '2026-03-10' })
    expect(presetRange('previousMonth', now)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetRange('previousMonth', new Date('2026-01-15T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('libellés de période et taux de marge', () => {
    expect(periodLabel('2026-10-12', 'week')).toBe('Semaine du 12/10/2026')
    expect(periodLabel('2026-10-01', 'month')).toBe('octobre 2026')
    expect(periodLabel('2026-10-17', 'day')).toBe('17/10/2026')
    expect(marginRate(25000, 100000)).toBe(25)
    expect(marginRate(1, 3)).toBe(33.3)
    expect(marginRate(0, 0)).toBeNull()
  })
})
