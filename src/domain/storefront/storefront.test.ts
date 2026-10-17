import { describe, expect, it } from 'vitest'
import { availabilityLabel, normalizeWhatsapp, orderMessage, topCategories, whatsappOrderUrl } from './storefront'

describe('vitrine', () => {
  it('normalise les numéros WhatsApp sénégalais et internationaux', () => {
    expect(normalizeWhatsapp('77 123 45 67')).toBe('221771234567')
    expect(normalizeWhatsapp('+221 77 123 45 67')).toBe('221771234567')
    expect(normalizeWhatsapp('00221771234567')).toBe('221771234567')
    expect(normalizeWhatsapp('33 820 00 00')).toBe('221338200000')
    expect(normalizeWhatsapp('+33 6 12 34 56 78')).toBe('33612345678')
    expect(normalizeWhatsapp('123')).toBeNull()
    expect(normalizeWhatsapp(null)).toBeNull()
  })

  it('prépare un message de commande sans rien envoyer', () => {
    const message = orderMessage('Quincaillerie Diop', { name: 'Câble 2,5 mm²', price: 400, currency: 'XOF', unit: 'Mètre' }, 'https://x/#/vitrine/s/produit/cable')
    expect(message).toBe('Bonjour Quincaillerie Diop, je souhaite commander : Câble 2,5 mm² (400 FCFA / Mètre). Quantité : … (https://x/#/vitrine/s/produit/cable)')
    expect(orderMessage('Q', null, 'u')).toBe('Bonjour Q, je souhaite passer une commande. (u)')
    expect(whatsappOrderUrl('77 123 45 67', 'Bonjour é')).toBe('https://wa.me/221771234567?text=Bonjour%20%C3%A9')
    expect(whatsappOrderUrl('', 'x')).toBeNull()
  })

  it('libellés de disponibilité, sans quantité', () => {
    expect(availabilityLabel('in_stock')).toBe('En stock')
    expect(availabilityLabel('on_order')).toBe('Sur commande')
    expect(availabilityLabel('autre')).toBe('Disponibilité à confirmer')
  })

  it('trie les familles par nombre de produits puis par nom', () => {
    const list = topCategories([
      { id: '1', parent_id: null, name: 'Électricité', slug: 'e', product_count: 2 },
      { id: '2', parent_id: null, name: 'Outillage', slug: 'o', product_count: 5 },
      { id: '3', parent_id: null, name: 'Bâtiment', slug: 'b', product_count: 2 },
    ])
    expect(list.map((c) => c.name)).toEqual(['Outillage', 'Bâtiment', 'Électricité'])
  })
})
