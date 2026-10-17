import { describe, expect, it } from 'vitest'
import { agingBucket, checkOverrideReason, checkPayment, creditDecision, groupByAging, validateCustomer } from './credit'

describe('crédit client', () => {
  it('plafond : accepté, autorisation du gérant, ou bloqué pour un vendeur', () => {
    expect(creditDecision(10000, 5000, 20000, 'cashier')).toEqual({ kind: 'ok' })
    expect(creditDecision(10000, 10000, 20000, 'cashier')).toEqual({ kind: 'ok' })
    expect(creditDecision(10000, 15000, 20000, 'cashier')).toEqual({ kind: 'blocked', message: 'Plafond de crédit dépassé : autorisation du gérant nécessaire.' })
    expect(creditDecision(10000, 15000, 20000, 'manager')).toEqual({ kind: 'override', excess: 5000 })
    expect(creditDecision(0, 1000, 0, 'owner')).toEqual({ kind: 'override', excess: 1000 })
    expect(creditDecision(0, 0, 1000, 'owner').kind).toBe('blocked')
  })

  it('motif d’autorisation et versement', () => {
    expect(checkOverrideReason(' ok ')).toMatch(/obligatoire/)
    expect(checkOverrideReason('Client fidèle depuis 2019')).toBeNull()
    expect(checkPayment(5000, 12000)).toBeNull()
    expect(checkPayment(13000, 12000)).toBe('Versement supérieur au solde dû.')
    expect(checkPayment(0, 12000)).toMatch(/invalide/)
    expect(checkPayment(10.5, 12000)).toMatch(/invalide/)
  })

  it('fiche client', () => {
    expect(validateCustomer({ name: ' ', phone: '', address: '', creditLimit: '' }, true)).toBe('Le nom du client est obligatoire.')
    expect(validateCustomer({ name: 'Moussa Ndiaye', phone: '77', address: '', creditLimit: '' }, true)).toBe('Téléphone invalide.')
    expect(validateCustomer({ name: 'Moussa', phone: '771234567', address: 'Pikine', creditLimit: '-1' }, true)).toMatch(/Plafond/)
    expect(validateCustomer({ name: 'Moussa', phone: '771234567', address: 'Pikine', creditLimit: '-1' }, false)).toBeNull()
    expect(validateCustomer({ name: 'Moussa', phone: '', address: '', creditLimit: '50 000' }, true)).toBeNull()
  })

  it('ancienneté des impayés', () => {
    expect(agingBucket(0)).toBe('0-30')
    expect(agingBucket(30)).toBe('0-30')
    expect(agingBucket(31)).toBe('31-60')
    expect(agingBucket(90)).toBe('61-90')
    expect(agingBucket(400)).toBe('90+')
    const groups = groupByAging([{ balance: 1000, days_outstanding: 3 }, { balance: 2500, days_outstanding: 45 }, { balance: 500, days_outstanding: 10 }])
    expect(groups['0-30']).toEqual({ count: 2, total: 1500 })
    expect(groups['31-60']).toEqual({ count: 1, total: 2500 })
    expect(groups['90+']).toEqual({ count: 0, total: 0 })
  })
})
