import { describe, expect, it } from 'vitest'
import { parseDelimited } from '../import/csv'
import { auditLabel, describeUserAgent, exportSummary, tableToCsv } from './security'

describe('données et sécurité', () => {
  it('libellés du journal', () => {
    expect(auditLabel('void_sale')).toBe('Annulation de vente')
    expect(auditLabel('credit_limit_override')).toBe('Dépassement de plafond autorisé')
    expect(auditLabel('inconnue')).toBe('inconnue')
  })

  it('résumé du navigateur des sessions', () => {
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome sur Android')
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari sur iPhone / iPad')
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge sur Windows')
    expect(describeUserAgent(null)).toBe('Appareil inconnu')
  })

  it('table exportée en CSV : union des colonnes, objets en JSON, relu par le lecteur d’import', () => {
    const csv = tableToCsv([{ id: 'a', name: 'Câble; 2,5', attributes: { brand: 'Nexans' } }, { id: 'b', price: 400 }])
    const table = parseDelimited(csv)
    expect(table.headers).toEqual(['id', 'name', 'attributes', 'price'])
    expect(table.rows[0]).toEqual(['a', 'Câble; 2,5', '{"brand":"Nexans"}', ''])
    expect(table.rows[1]).toEqual(['b', '', '', '400'])
  })

  it('résumé de l’export', () => {
    expect(exportSummary({
      format: 'bardec-boutique-export', version: 1, site_id: 's', exported_at: '', row_limit_per_table: 20000,
      truncated_tables: ['inventory_movements'], tables: { products: [{}, {}], inventory_movements: [{}] },
    })).toEqual([{ table: 'inventory_movements', rows: 1, truncated: true }, { table: 'products', rows: 2, truncated: false }])
  })
})
