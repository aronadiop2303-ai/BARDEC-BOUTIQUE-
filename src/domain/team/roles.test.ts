import { describe, expect, it } from 'vitest'
import { permissionsFor } from '../../lib/store/permissions'
import { canAssignRole, canManageMember, legacyToEffective, normalizeEmail, validateInviteRequest } from './roles'

const SITE = '11111111-1111-4111-8111-111111111111'

describe('attribution des rôles', () => {
  it('le propriétaire attribue tout ; le gérant tout sauf gérant ; les autres rien', () => {
    expect(canAssignRole('owner', 'manager')).toBe(true)
    expect(canAssignRole('manager', 'manager')).toBe(false)
    expect(canAssignRole('manager', 'cashier')).toBe(true)
    expect(canAssignRole('manager', 'driver')).toBe(true)
    for (const role of ['cashier', 'stock_keeper', 'driver', 'viewer', null] as const) {
      expect(canAssignRole(role, 'cashier')).toBe(false)
    }
  })

  it('personne ne se modifie soi-même ni ne touche au propriétaire ; un gérant ne touche pas un gérant', () => {
    expect(canManageMember('owner', 'u1', 'u1', 'manager')).toBe(false)
    expect(canManageMember('owner', 'u1', 'u2', 'owner')).toBe(false)
    expect(canManageMember('manager', 'u1', 'u2', 'owner')).toBe(false)
    expect(canManageMember('manager', 'u1', 'u2', 'manager')).toBe(false)
    expect(canManageMember('manager', 'u1', 'u2', 'cashier')).toBe(true)
    expect(canManageMember('owner', 'u1', 'u2', 'manager')).toBe(true)
    expect(canManageMember('cashier', 'u1', 'u2', 'driver')).toBe(false)
  })

  it('valide la demande d’invitation', () => {
    expect(validateInviteRequest({ site_id: SITE, email: ' Awa@Example.SN ', staff_role: 'cashier' }))
      .toEqual({ ok: true, value: { site_id: SITE, email: 'awa@example.sn', staff_role: 'cashier' } })
    expect(validateInviteRequest({ site_id: SITE, email: 'awa@', staff_role: 'cashier' })).toEqual({ ok: false, message: 'Adresse e-mail invalide.' })
    expect(validateInviteRequest({ site_id: SITE, email: 'a@b.sn', staff_role: 'owner' })).toEqual({ ok: false, message: 'Rôle invalide.' })
    expect(validateInviteRequest({ site_id: 'x', email: 'a@b.sn', staff_role: 'cashier' })).toEqual({ ok: false, message: 'Boutique invalide.' })
    expect(validateInviteRequest(null).ok).toBe(false)
    expect(normalizeEmail(42)).toBeNull()
  })
})

describe('permissions minimales par rôle', () => {
  it('gérant et propriétaire : tout, y compris équipe, annulation, import, prix d’achat', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(permissionsFor(role)).toMatchObject({ manageTeam: true, voidSales: true, importProducts: true, viewCosts: true, previewStorefront: true, deliveries: false })
    }
    expect(Object.entries(permissionsFor('owner')).filter(([, v]) => !v).map(([k]) => k)).toEqual(['deliveries'])
    // Lot D : publication réservée au propriétaire.
    expect(permissionsFor('owner').publish).toBe(true)
    expect(permissionsFor('manager').publish).toBe(false)
  })

  it('vendeur : caisse et encaissement ; ni annulation, ni prix d’achat, ni import, ni stock', () => {
    expect(permissionsFor('cashier')).toMatchObject({
      accessPos: true, sell: true, voidSales: false, viewCosts: false, importProducts: false, writeStock: false, manageTeam: false, editCatalog: false,
    })
  })

  it('magasinier : stock sans caisse ni prix d’achat', () => {
    expect(permissionsFor('stock_keeper')).toMatchObject({ viewStock: true, writeStock: true, accessPos: false, sell: false, viewCosts: false, receivePurchases: true, purchases: false })
  })

  it('livreur : uniquement ses livraisons', () => {
    const can = permissionsFor('driver')
    expect(can.deliveries).toBe(true)
    expect(Object.entries(can).filter(([, v]) => v).map(([k]) => k)).toEqual(['deliveries'])
  })

  it('anciens rôles de membre : même comportement qu’avant', () => {
    expect(legacyToEffective('admin')).toBe('manager')
    expect(legacyToEffective('editor')).toBe('cashier')
    expect(legacyToEffective('publisher')).toBe('viewer')
    expect(permissionsFor('admin')).toEqual(permissionsFor('manager'))
    expect(permissionsFor('editor')).toMatchObject({ sell: true, voidSales: false, writeStock: false, configure: false })
    expect(permissionsFor('viewer')).toMatchObject({ sell: false, voidSales: false, accessPos: true })
  })
})
