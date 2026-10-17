// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { fakeSupabase, type FakeResult } from '../../test/fakeSupabase'
import { permissionsFor } from '../../lib/store/permissions'
import type { StoreRole } from '../../lib/store/access'
import type { BoutiqueContext } from './context'
import ImportPage, { readCsvFile } from './ImportPage'

configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)

const SITE = '11111111-1111-4111-8111-111111111111'

function setup(role: StoreRole, responses: FakeResult[]) {
  const fake = fakeSupabase(responses)
  const ctx: BoutiqueContext = {
    client: fake.client, userId: 'u-1', siteId: SITE,
    access: { site: { id: SITE, workspace_id: 'ws', name: 'Quincaillerie Diop', slug: 'q', site_type: 'store', status: 'draft', category_id: 'c' }, workspace: { id: 'ws', name: 'Espace', owner_id: 'owner' }, role, isHardware: true },
    can: permissionsFor(role),
  }
  render(<ImportPage ctx={ctx} />)
  return fake
}

const installed: FakeResult = { data: null, count: 0 }
const missing: FakeResult = { error: { code: 'PGRST205', message: 'Could not find the table public.product_import_runs' } }
const units: FakeResult = { data: [{ id: 'unit-u', code: 'u', label: 'Pièce', decimal_places: 0 }, { id: 'unit-m', code: 'm', label: 'Mètre', decimal_places: 2 }] }
const locations: FakeResult = { data: [{ id: 'loc-1', name: 'Magasin', is_active: true }] }
const existing: FakeResult = { data: [{ id: 'p-old', name: 'Pince', sku: 'PIN-1', barcode: null }] }
const noRuns: FakeResult = { data: [] }

async function paste(text: string) {
  fireEvent.click(await screen.findByLabelText(/Copier-coller/))
  fireEvent.change(screen.getByLabelText('Cellules collées'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
}

describe('écran Importer des produits', () => {
  it('réservé au propriétaire et aux administrateurs', () => {
    setup('editor', [])
    expect(screen.getByText('L’import est réservé au propriétaire et aux administrateurs.')).toBeTruthy()
  })

  it('propose les quatre méthodes livrées ; API et OCR sont visibles mais indisponibles', async () => {
    setup('owner', [installed, units, locations, existing, noRuns])
    for (const label of [/Fichier CSV/, /Fichier Excel/, /Copier-coller/, /Ajout rapide en série/]) {
      expect((await screen.findByLabelText(label) as HTMLInputElement).disabled).toBe(false)
    }
    expect((screen.getByLabelText(/Connecteur \/ API/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(/Photo d’une liste/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Télécharger le modèle CSV/ })).toBeTruthy()
  })

  it('collage tabulé : mapping proposé, erreurs en rouge, import bloqué', async () => {
    setup('owner', [installed, units, locations, existing, noRuns])
    await paste('Désignation\tRéférence\tPrix\tQté\nMarteau\tMAR-1\t5000\t2,5\nPince\tpin-1\t2000\t\n\t\t\t\nScie\tSCI-1\t\t')
    expect((screen.getByLabelText('Colonne pour Nom') as HTMLSelectElement).value).toBe('0')
    expect((screen.getByLabelText('Colonne pour Prix de vente') as HTMLSelectElement).value).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Voir l’aperçu' }))

    const table = await screen.findByRole('table', { name: 'Lignes à importer' })
    expect(within(table).getByText('Stock initial : nombre entier attendu pour l’unité « Pièce ».')).toBeTruthy()
    expect(within(table).getByText('SKU « pin-1 » déjà utilisé par « Pince ».')).toBeTruthy()
    expect(within(table).getByText('Prix de vente obligatoire.')).toBeTruthy()
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText(/3 ligne\(s\) : 0 valide\(s\), 3 en erreur/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Importer/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirmation explicite puis appel de import_products sans champ résolu par le client', async () => {
    const fake = setup('owner', [
      installed, units, locations, existing, noRuns,
      { data: { import_id: 'run-1', status: 'succeeded', row_count: 2, created: 2, updated: 0, stock_movements: 1, errors: [] } },
      installed, units, locations, existing, noRuns,
    ])
    await paste('Nom;SKU;Unité;Prix de vente;Prix d’achat;Stock initial\nCâble 2,5 mm²;CAB-25;m;400;250;12,5\nÉquerre;EQ-1;u;1500;;')
    fireEvent.click(screen.getByRole('button', { name: 'Voir l’aperçu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Importer 2 produits' }))
    expect(fake.queries.some((q) => q.table === 'rpc:import_products')).toBe(false)
    expect(screen.getByText(/2 création\(s\), 0 mise\(s\) à jour/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’import' }))

    expect(await screen.findByText('Import terminé')).toBeTruthy()
    const call = fake.queries.find((q) => q.table === 'rpc:import_products')!
    const args = fake.op(call, 'rpc')?.[0] as { p_rows: Record<string, unknown>[]; p_mode: string; p_source: string; p_site_id: string }
    expect(args).toMatchObject({ p_site_id: SITE, p_mode: 'create', p_source: 'paste' })
    expect(args.p_rows[0]).toEqual({
      line: 2, name: 'Câble 2,5 mm²', sku: 'CAB-25', barcode: null, category: null, unit_id: 'unit-m',
      price: 400, cost: 250, initial_stock: 12.5, location_id: 'loc-1',
    })
    expect(args.p_rows[1]).not.toHaveProperty('action')
    expect(args.p_rows[1]).not.toHaveProperty('product_id')
  })

  it('affiche le refus de la base sans rien prétendre enregistré', async () => {
    setup('owner', [
      installed, units, locations, existing, noRuns,
      { data: { import_id: 'run-2', status: 'failed', row_count: 1, created: 0, updated: 0, stock_movements: 0, errors: [{ line: 2, message: 'SKU « X » déjà utilisé dans la boutique.' }] } },
    ])
    await paste('Nom;SKU;Prix\nVis;X;10')
    fireEvent.click(screen.getByRole('button', { name: 'Voir l’aperçu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Importer 1 produit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’import' }))
    expect(await screen.findByText(/La base a refusé l’import, rien n’a été enregistré/)).toBeTruthy()
    expect(screen.getByText('Ligne 2 : SKU « X » déjà utilisé dans la boutique.')).toBeTruthy()
    expect(screen.queryByText('Import terminé')).toBeNull()
  })

  it('migration absente : aperçu possible, import désactivé', async () => {
    setup('admin', [missing, units, locations, existing])
    expect(await screen.findByText(/la migration/)).toBeTruthy()
    await paste('Nom;Prix\nVis;10')
    fireEvent.click(screen.getByRole('button', { name: 'Voir l’aperçu' }))
    expect((await screen.findByRole('button', { name: 'Importer 1 produit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ajout rapide en série : passe directement à l’aperçu', async () => {
    setup('owner', [installed, units, locations, existing, noRuns])
    fireEvent.click(await screen.findByLabelText(/Ajout rapide en série/))
    fireEvent.change(screen.getByLabelText('Nom ligne 1'), { target: { value: 'Clé à molette' } })
    fireEvent.change(screen.getByLabelText('Prix de vente ligne 1'), { target: { value: '3500' } })
    fireEvent.change(screen.getByLabelText('Nom ligne 2'), { target: { value: 'Tournevis' } })
    fireEvent.change(screen.getByLabelText('Prix de vente ligne 2'), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier 2 produits' }))
    expect(await screen.findByRole('button', { name: 'Importer 2 produits' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Correspondance des colonnes' })).toBeNull()
  })
})

describe('lecture d’un fichier CSV', () => {
  it('UTF-8 lu tel quel ; Windows-1252 détecté et relu', async () => {
    const utf8 = await readCsvFile(new Blob([new TextEncoder().encode('Nom;Prix\nÉquerre;10')]))
    expect(utf8).toEqual({ text: 'Nom;Prix\nÉquerre;10', legacyEncoding: false })
    const latin = await readCsvFile(new Blob([new Uint8Array([0xc9, 0x71, 0x75, 0x65, 0x72, 0x72, 0x65])]))
    expect(latin).toEqual({ text: 'Équerre', legacyEncoding: true })
  })
})
