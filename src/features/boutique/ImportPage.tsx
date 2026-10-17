import { useMemo, useState } from 'react'
import { ArrowLeft, Download, Plus, Trash2, Upload } from 'lucide-react'
import { ErrorPanel, Loading } from '../../components/StatePanel'
import { parseDelimited } from '../../domain/import/csv'
import {
  applyMapping, duplicateColumns, FIELD_LABELS, IMPORT_FIELDS, missingRequired, suggestMapping,
  type ColumnMapping, type ImportField,
} from '../../domain/import/mapping'
import { IMPORT_SOURCES, type ImportSourceId } from '../../domain/import/sources'
import type { RawTable } from '../../domain/import/table'
import { csvTemplate, TEMPLATE_HEADERS } from '../../domain/import/template'
import { MAX_IMPORT_ROWS, validateImport, type ImportMode } from '../../domain/import/validate'
import { parseXlsx, XLSX_MAX_BYTES } from '../../domain/import/xlsx'
import { formatShopDateTime } from '../../domain/pos/history'
import { boutiquePath } from '../../lib/router'
import { isImportInstalled, listImportRuns, loadImportContext, runImport, type ImportResult } from '../../lib/store/imports'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

type Step = 'source' | 'mapping' | 'preview' | 'done'

const SOURCE_LABELS = Object.fromEntries(IMPORT_SOURCES.map((s) => [s.id, s.label])) as Record<ImportSourceId, string>

/** CSV : UTF-8 attendu ; un export Excel « CSV » en Windows-1252 est relu dans cet encodage, avec un avertissement. */
export async function readCsvFile(file: Blob): Promise<{ text: string; legacyEncoding: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), legacyEncoding: false }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), legacyEncoding: true }
  }
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([csvTemplate(';')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'modele-import-produits.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Produits › Importer : méthode → colonnes → aperçu validé ligne par ligne → confirmation → import. */
export default function ImportPage({ ctx }: { ctx: BoutiqueContext }) {
  const data = useAsync(async () => {
    const installed = await isImportInstalled(ctx.client)
    const context = await loadImportContext(ctx.client, ctx.siteId)
    const runs = installed ? await listImportRuns(ctx.client, ctx.siteId) : []
    return { installed, context, runs }
  }, [ctx.client, ctx.siteId])
  const [step, setStep] = useState<Step>('source')
  const [source, setSource] = useState<ImportSourceId>('csv')
  const [table, setTable] = useState<RawTable | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [mode, setMode] = useState<ImportMode>('create')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const heading = (
    <div className="bq-heading">
      <div><p className="eyebrow">CATALOGUE</p><h1 className="bq-title">Importer des produits</h1></div>
      <a className="secondary-button" href={boutiquePath(ctx.siteId, 'produits')}><ArrowLeft size={15} /> Produits</a>
    </div>
  )

  if (!ctx.can.importProducts) {
    return <div className="bq-stack">{heading}<p className="notice" role="status">L’import est réservé au propriétaire et aux administrateurs.</p></div>
  }
  if (data.status === 'loading') return <div className="bq-stack">{heading}<Loading /></div>
  if (data.status === 'error') return <div className="bq-stack">{heading}<ErrorPanel message={data.message} onRetry={data.reload} /></div>

  const { installed, context, runs } = data.data

  function loaded(next: RawTable, from: ImportSourceId, message = '') {
    if (next.headers.length === 0) { setNotice('Aucune donnée trouvée : la source est vide.'); return }
    setSource(from)
    setTable(next)
    setMapping(suggestMapping(next.headers))
    setNotice(message)
    setStep(from === 'manual' ? 'preview' : 'mapping')
  }

  function restart() {
    setStep('source'); setTable(null); setMapping(null); setResult(null); setNotice('')
  }

  return (
    <div className="bq-stack">
      {heading}
      {!installed && (
        <p className="bq-error" role="alert">
          L’import n’est pas encore activé : la migration <code>product_import</code> n’est pas appliquée à la base.
          Vous pouvez préparer et vérifier un fichier ; rien ne sera enregistré.
        </p>
      )}
      <ol className="bq-steps" aria-label="Étapes">
        {(['source', 'mapping', 'preview', 'done'] as Step[]).map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={s === step ? 'active' : ''}>
            {i + 1}. {{ source: 'Méthode', mapping: 'Colonnes', preview: 'Aperçu', done: 'Résultat' }[s]}
          </li>
        ))}
      </ol>
      {notice && <p className="notice" role="status">{notice}</p>}

      {step === 'source' && <SourceStep units={context.units} locations={context.locations} onLoaded={loaded} onError={setNotice} />}
      {step === 'mapping' && table && mapping && (
        <MappingStep table={table} mapping={mapping} onChange={setMapping} onBack={restart} onNext={() => setStep('preview')} />
      )}
      {step === 'preview' && table && mapping && (
        <PreviewStep
          ctx={ctx} installed={installed} table={table} mapping={mapping} mode={mode} onMode={setMode} source={source}
          context={context} onBack={() => (source === 'manual' ? restart() : setStep('mapping'))}
          onDone={(r) => { setResult(r); setStep('done'); data.reload() }}
        />
      )}
      {step === 'done' && result && <ResultStep result={result} siteId={ctx.siteId} onRestart={restart} />}

      {runs.length > 0 && (
        <section className="bq-card bq-stack" aria-label="Derniers imports">
          <h2 className="bq-subtitle">Derniers imports</h2>
          <div className="bq-table-wrap">
            <table className="bq-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Méthode</th><th scope="col" className="num">Lignes</th><th scope="col" className="num">Créés</th><th scope="col" className="num">Mis à jour</th><th scope="col">Résultat</th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatShopDateTime(run.created_at)}</td>
                    <td>{SOURCE_LABELS[run.source] ?? run.source}</td>
                    <td className="num">{run.row_count}</td>
                    <td className="num">{run.created_count}</td>
                    <td className="num">{run.updated_count}</td>
                    <td>{run.status === 'succeeded' ? <span className="bq-badge">Réussi</span> : <span className="bq-badge bq-badge-void">Échoué, rien importé</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ── 1. Méthode ───────────────────────────────────────────────────────────────

function SourceStep({ units, locations, onLoaded, onError }: {
  units: { id: string; code: string; label: string }[]
  locations: { id: string; name: string; is_active: boolean }[]
  onLoaded: (table: RawTable, source: ImportSourceId, message?: string) => void
  onError: (message: string) => void
}) {
  const [method, setMethod] = useState<ImportSourceId>('csv')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)

  async function readFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    onError('')
    try {
      if (method === 'xlsx') {
        if (file.size > XLSX_MAX_BYTES) throw new Error('Fichier trop volumineux (5 Mo au plus).')
        onLoaded(await parseXlsx(new Uint8Array(await file.arrayBuffer())), 'xlsx')
      } else {
        const { text, legacyEncoding } = await readCsvFile(file)
        onLoaded(parseDelimited(text), 'csv', legacyEncoding
          ? 'Fichier non UTF-8 : relu en Windows-1252 (export CSV d’Excel). Vérifiez les accents dans l’aperçu.' : '')
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Fichier illisible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Méthode d’import">
      <h2 className="bq-subtitle">Choisir la méthode</h2>
      <div className="bq-source-grid" role="radiogroup" aria-label="Méthodes">
        {IMPORT_SOURCES.map((s) => (
          <label key={s.id} className={`bq-source${method === s.id ? ' active' : ''}${s.available ? '' : ' muted'}`}>
            <input type="radio" name="source" value={s.id} checked={method === s.id} disabled={!s.available} onChange={() => setMethod(s.id)} />
            <strong>{s.label}</strong>
            <small>{s.available ? s.description : 'Prévu plus tard : pas encore disponible.'}</small>
          </label>
        ))}
      </div>
      <p className="bq-row">
        <button type="button" className="text-button" onClick={downloadTemplate}><Download size={15} /> Télécharger le modèle CSV</button>
        <small className="bq-hint">Colonnes : {TEMPLATE_HEADERS.join(' ; ')}. Maximum {MAX_IMPORT_ROWS} lignes par import.</small>
      </p>

      {(method === 'csv' || method === 'xlsx') && (
        <label className="bq-inline-field">
          <span><Upload size={15} /> {method === 'csv' ? 'Fichier .csv' : 'Fichier .xlsx'}</span>
          <input
            type="file" disabled={busy}
            accept={method === 'csv' ? '.csv,text/csv' : '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
            aria-label={method === 'csv' ? 'Choisir un fichier CSV' : 'Choisir un fichier Excel'}
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </label>
      )}
      {method === 'paste' && (
        <div className="bq-stack">
          <label className="bq-inline-field">Cellules copiées depuis le tableur (ligne d’en-têtes comprise)
            <textarea rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Cellules collées" />
          </label>
          <div><button className="primary-button" disabled={!pasted.trim()} onClick={() => onLoaded(parseDelimited(pasted), 'paste')}>Continuer</button></div>
        </div>
      )}
      {method === 'manual' && <ManualEntry units={units} locations={locations} onDone={(t) => onLoaded(t, 'manual')} />}
    </section>
  )
}

type ManualRow = { key: number; values: string[] }
let nextManualKey = 1
const emptyManual = (unit: string): ManualRow => ({ key: nextManualKey++, values: ['', '', '', '', unit, '', '', '', ''] })

/** Ajout rapide en série : mêmes colonnes que le modèle, une ligne par produit. */
function ManualEntry({ units, locations, onDone }: {
  units: { id: string; code: string; label: string }[]
  locations: { id: string; name: string; is_active: boolean }[]
  onDone: (table: RawTable) => void
}) {
  const defaultUnit = units.find((u) => u.code === 'u')?.code ?? units[0]?.code ?? ''
  const [rows, setRows] = useState<ManualRow[]>(() => [emptyManual(defaultUnit), emptyManual(defaultUnit), emptyManual(defaultUnit)])
  const update = (key: number, index: number, value: string) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, values: r.values.map((v, i) => (i === index ? value : v)) } : r)))
  const filled = rows.filter((r) => r.values.some((v, i) => i !== 4 && v.trim() !== ''))

  return (
    <div className="bq-stack">
      <div className="bq-table-wrap">
        <table className="bq-table" aria-label="Saisie en série">
          <thead><tr>{TEMPLATE_HEADERS.map((h) => <th scope="col" key={h}>{h}</th>)}<th scope="col"><span className="sr-only">Retirer</span></th></tr></thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.key}>
                {TEMPLATE_HEADERS.map((header, i) => (
                  <td key={header}>
                    {i === 4 ? (
                      <select aria-label={`${header} ligne ${r + 1}`} value={row.values[i]} onChange={(e) => update(row.key, i, e.target.value)}>
                        {units.map((u) => <option key={u.id} value={u.code}>{u.label}</option>)}
                      </select>
                    ) : i === 8 ? (
                      <select aria-label={`${header} ligne ${r + 1}`} value={row.values[i]} onChange={(e) => update(row.key, i, e.target.value)}>
                        <option value="">Par défaut</option>
                        {locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    ) : (
                      <input
                        className={i === 0 ? 'name-input' : 'bq-qty'} aria-label={`${header} ligne ${r + 1}`} value={row.values[i]}
                        inputMode={i >= 5 && i <= 7 ? 'decimal' : undefined} onChange={(e) => update(row.key, i, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td><button className="text-button" aria-label={`Retirer la ligne ${r + 1}`} onClick={() => setRows((list) => list.filter((x) => x.key !== row.key))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bq-row">
        <button className="text-button" onClick={() => setRows((list) => [...list, emptyManual(defaultUnit)])}><Plus size={15} /> Ajouter une ligne</button>
        <button
          className="primary-button" disabled={filled.length === 0}
          onClick={() => onDone({ headers: TEMPLATE_HEADERS, rows: filled.map((r) => r.values), lines: filled.map((r) => rows.indexOf(r) + 1) })}
        >
          Vérifier {filled.length} produit{filled.length > 1 ? 's' : ''}
        </button>
      </div>
    </div>
  )
}

// ── 2. Colonnes ──────────────────────────────────────────────────────────────

function MappingStep({ table, mapping, onChange, onBack, onNext }: {
  table: RawTable
  mapping: ColumnMapping
  onChange: (mapping: ColumnMapping) => void
  onBack: () => void
  onNext: () => void
}) {
  const missing = missingRequired(mapping)
  const duplicates = duplicateColumns(mapping)
  const set = (field: ImportField, value: string) => onChange({ ...mapping, [field]: value === '' ? null : Number(value) })

  return (
    <section className="bq-card bq-stack" aria-label="Correspondance des colonnes">
      <h2 className="bq-subtitle">Associer les colonnes</h2>
      <p className="bq-hint">{table.rows.length} ligne(s) lue(s). Colonnes proposées d’après les en-têtes : vérifiez-les.</p>
      <div className="bq-mapping">
        {IMPORT_FIELDS.map((field) => (
          <label key={field} className="bq-inline-field">
            <span>{FIELD_LABELS[field]}{field === 'name' || field === 'price' ? ' *' : ''}</span>
            <select aria-label={`Colonne pour ${FIELD_LABELS[field]}`} value={mapping[field] ?? ''} onChange={(e) => set(field, e.target.value)}>
              <option value="">— Ne pas importer —</option>
              {table.headers.map((h, i) => <option key={i} value={i}>{h}{table.rows[0]?.[i] ? ` (ex. ${table.rows[0][i].slice(0, 30)})` : ''}</option>)}
            </select>
          </label>
        ))}
      </div>
      {missing.length > 0 && <p className="bq-error" role="alert">Colonne obligatoire non associée : {missing.map((f) => FIELD_LABELS[f]).join(', ')}.</p>}
      {duplicates.length > 0 && <p className="bq-error" role="alert">Une même colonne est associée à plusieurs champs : {duplicates.map((i) => table.headers[i]).join(', ')}.</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onBack}>Changer de source</button>
        <button className="primary-button" disabled={missing.length > 0 || duplicates.length > 0} onClick={onNext}>Voir l’aperçu</button>
      </div>
    </section>
  )
}

// ── 3. Aperçu et confirmation ────────────────────────────────────────────────

function PreviewStep({ ctx, installed, table, mapping, mode, onMode, source, context, onBack, onDone }: {
  ctx: BoutiqueContext
  installed: boolean
  table: RawTable
  mapping: ColumnMapping
  mode: ImportMode
  onMode: (mode: ImportMode) => void
  source: ImportSourceId
  context: Awaited<ReturnType<typeof loadImportContext>>
  onBack: () => void
  onDone: (result: ImportResult) => void
}) {
  const preview = useMemo(() => validateImport(applyMapping(table, mapping), { ...context, mode }), [table, mapping, context, mode])
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverErrors, setServerErrors] = useState<ImportResult['errors']>([])
  const shown = onlyErrors ? preview.rows.filter((r) => r.errors.length > 0) : preview.rows
  const ready = installed && !preview.tooMany && preview.errorCount === 0 && preview.rows.length > 0
  const payloads = preview.rows.flatMap((r) => (r.payload ? [r.payload] : []))
  const creates = payloads.filter((p) => p.action === 'create').length
  const stockRows = payloads.filter((p) => p.initial_stock !== null).length

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const result = await runImport(ctx.client, ctx.siteId, payloads, mode, source)
      if (result.status === 'succeeded') onDone(result)
      else { setServerErrors(result.errors); setConfirming(false) }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bq-card bq-stack" aria-label="Aperçu de l’import">
      <h2 className="bq-subtitle">Aperçu</h2>
      <div className="bq-row">
        <label className="bq-inline-field">Si le SKU existe déjà
          <select value={mode} onChange={(e) => { onMode(e.target.value as ImportMode); setConfirming(false) }}>
            <option value="create">Refuser la ligne (création seulement)</option>
            <option value="upsert">Mettre à jour le produit existant</option>
          </select>
        </label>
        <label className="bq-row"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Seulement les lignes en erreur</label>
      </div>
      <p role="status" className={preview.errorCount > 0 ? 'bq-error' : 'notice'}>
        {preview.rows.length} ligne(s) : {preview.validCount} valide(s), {preview.errorCount} en erreur.
        {preview.errorCount > 0 && ' Corrigez la source puis recommencez : l’import est tout ou rien.'}
      </p>
      {preview.tooMany && <p className="bq-error" role="alert">Plus de {MAX_IMPORT_ROWS} lignes : découpez le fichier en plusieurs imports.</p>}
      {serverErrors.length > 0 && (
        <div className="bq-error" role="alert">
          La base a refusé l’import, rien n’a été enregistré :
          <ul>{serverErrors.map((e, i) => <li key={i}>{e.line ? `Ligne ${e.line} : ` : ''}{e.message}</li>)}</ul>
        </div>
      )}

      <div className="bq-table-wrap">
        <table className="bq-table" aria-label="Lignes à importer">
          <thead><tr><th scope="col">Ligne</th>{IMPORT_FIELDS.map((f) => <th scope="col" key={f}>{FIELD_LABELS[f]}</th>)}<th scope="col">Contrôle</th></tr></thead>
          <tbody>
            {shown.slice(0, 300).map((row) => (
              <tr key={row.line} className={row.errors.length > 0 ? 'bq-row-error' : undefined}>
                <td>{row.line}</td>
                {IMPORT_FIELDS.map((f) => <td key={f}>{row.values[f] || <span className="bq-muted">—</span>}</td>)}
                <td>
                  {row.errors.map((e) => <small key={e} className="bq-error">{e}</small>)}
                  {row.warnings.map((w) => <small key={w} className="bq-muted">{w}</small>)}
                  {row.errors.length === 0 && <small>{row.payload?.action === 'update' ? 'Mise à jour' : 'Création'}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <p className="bq-hint">300 premières lignes affichées sur {shown.length}.</p>}

      {error && <p className="bq-error" role="alert">{error}</p>}
      {confirming ? (
        <div className="notice bq-stack" role="group" aria-label="Confirmation">
          <strong>
            Confirmer l’import de {payloads.length} ligne(s) : {creates} création(s), {payloads.length - creates} mise(s) à jour,
            {' '}{stockRows} stock(s) initial(aux).
          </strong>
          <span>Tout ou rien : en cas d’erreur, aucun produit n’est enregistré.</span>
          <div className="modal-actions">
            <button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Revenir</button>
            <button className="primary-button" disabled={busy} onClick={confirm}>{busy ? 'Import en cours…' : 'Confirmer l’import'}</button>
          </div>
        </div>
      ) : (
        <div className="modal-actions">
          <button className="secondary-button" onClick={onBack}>Retour</button>
          <button className="primary-button" disabled={!ready} onClick={() => setConfirming(true)}>Importer {payloads.length} produit{payloads.length > 1 ? 's' : ''}</button>
        </div>
      )}
    </section>
  )
}

// ── 4. Résultat ──────────────────────────────────────────────────────────────

function ResultStep({ result, siteId, onRestart }: { result: ImportResult; siteId: string; onRestart: () => void }) {
  return (
    <section className="bq-card bq-stack" aria-label="Résultat de l’import">
      <h2 className="bq-subtitle" role="status">Import terminé</h2>
      <p>{result.created} produit(s) créé(s), {result.updated} mis à jour, {result.stock_movements} stock(s) initial(aux) enregistré(s).</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onRestart}>Nouvel import</button>
        <a className="primary-button" href={boutiquePath(siteId, 'produits')}>Voir les produits</a>
      </div>
    </section>
  )
}
