import { useState } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { Empty, ErrorPanel, Loading } from '../../components/StatePanel'
import { buildFamilyTree, createFamily, flattenFamilies, listFamilies, updateFamily, type FamilyNode } from '../../lib/store/categories'
import { useAsync } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/** Arborescence des familles. Pas de suppression : une famille se désactive (ses produits restent rattachés). */
export default function FamiliesPage({ ctx }: { ctx: BoutiqueContext }) {
  const families = useAsync(() => listFamilies(ctx.client, ctx.siteId), [ctx.client, ctx.siteId])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<string | 'root' | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await action()
      families.reload()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const ok = await run(() => createFamily(ctx.client, ctx.siteId, { name, parentId: adding === 'root' ? null : adding }))
    if (ok) { setAdding(null); setName('') }
  }

  async function rename(node: FamilyNode) {
    const ok = await run(() => updateFamily(ctx.client, ctx.siteId, node.id, { name: editName }))
    if (ok) setEditing(null)
  }

  const addForm = (
    <div className="bq-row">
      <input className="name-input bq-grow" aria-label="Nom de la nouvelle famille" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="Ex. : Tuyaux PVC" />
      <button className="primary-button" onClick={add} disabled={busy}><Check size={15} /> Ajouter</button>
      <button className="secondary-button" onClick={() => { setAdding(null); setName('') }}>Annuler</button>
    </div>
  )

  return (
    <div className="bq-stack">
      <div className="bq-heading">
        <div><p className="eyebrow">CATALOGUE</p><h1 className="bq-title">Familles de produits</h1></div>
        {ctx.can.editCatalog && <button className="primary-button" onClick={() => { setAdding('root'); setName('') }}><Plus size={16} /> Nouvelle famille</button>}
      </div>
      {error && <p role="alert" className="bq-error">{error}</p>}
      {adding === 'root' && addForm}

      {families.status === 'loading' && <Loading />}
      {families.status === 'error' && <ErrorPanel message={families.message} onRetry={families.reload} />}
      {families.status === 'ready' && families.data.length === 0 && <Empty title="Aucune famille.">Ajoutez-en une ou relancez la configuration.</Empty>}
      {families.status === 'ready' && families.data.length > 0 && (
        <ul className="bq-tree">
          {flattenFamilies(buildFamilyTree(families.data)).map((node) => (
            <li key={node.id} style={{ paddingLeft: node.depth * 22 }} className={node.is_active ? '' : 'inactive'}>
              {editing === node.id ? (
                <div className="bq-row">
                  <input className="name-input bq-grow" aria-label={`Nouveau nom de ${node.name}`} autoFocus maxLength={120} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename(node) }} />
                  <button className="primary-button" onClick={() => rename(node)} disabled={busy}><Check size={15} /> Enregistrer</button>
                  <button className="icon-button" aria-label="Annuler" onClick={() => setEditing(null)}><X size={15} /></button>
                </div>
              ) : (
                <div className="bq-row">
                  <strong className="bq-grow">{node.name}{!node.is_active && <small className="bq-muted"> (désactivée)</small>}</strong>
                  {ctx.can.editCatalog && (
                    <>
                      <button className="text-button" onClick={() => { setAdding(node.id); setName('') }}><Plus size={13} /> Sous-famille</button>
                      <button className="text-button" onClick={() => { setEditing(node.id); setEditName(node.name) }}><Pencil size={13} /> Renommer</button>
                      <button className="text-button" onClick={() => run(() => updateFamily(ctx.client, ctx.siteId, node.id, { is_active: !node.is_active }))} disabled={busy}>
                        {node.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </>
                  )}
                </div>
              )}
              {adding === node.id && addForm}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
