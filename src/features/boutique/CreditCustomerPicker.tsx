import { useState } from 'react'
import { Search } from 'lucide-react'
import { formatMoney } from '../../domain/hardware/money'
import { checkOverrideReason, type CreditDecision } from '../../domain/customers/credit'
import { customerBalance, listCustomers, type Customer } from '../../lib/store/customers'
import { useAsync, useDebounced } from '../../lib/useAsync'
import type { BoutiqueContext } from './context'

/** Choix de la fiche client d'une vente à crédit, avec solde (base) et plafond ; motif si le gérant dépasse le plafond. */
export default function CreditCustomerPicker({ ctx, customer, balance, decision, override, onSelect, onOverride }: {
  ctx: BoutiqueContext
  customer: Customer | null
  balance: number | null
  decision: CreditDecision | null
  override: string
  onSelect: (customer: Customer | null, balance: number | null) => void
  onOverride: (value: string) => void
}) {
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 250)
  const results = useAsync(() => (term.trim() ? listCustomers(ctx.client, ctx.siteId, term) : Promise.resolve([] as Customer[])), [ctx.client, ctx.siteId, term])
  const [error, setError] = useState('')

  async function choose(c: Customer) {
    setError('')
    try {
      onSelect(c, await customerBalance(ctx.client, ctx.siteId, c.id))
      setSearch('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Solde illisible.')
    }
  }

  return (
    <div className="bq-stack" aria-label="Client à crédit">
      {customer ? (
        <div className="bq-row">
          <strong className="bq-grow">Crédit pour : {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</strong>
          <span>Solde dû {balance === null ? '…' : formatMoney(balance)} · plafond {formatMoney(customer.credit_limit)}</span>
          <button className="text-button" onClick={() => onSelect(null, null)}>Changer</button>
        </div>
      ) : (
        <>
          <label className="search-box bq-search">
            <Search size={16} />
            <input aria-label="Rechercher la fiche client" value={search} placeholder="Fiche client : nom ou téléphone…" onChange={(e) => setSearch(e.target.value)} />
          </label>
          {results.status === 'error' && <p className="bq-error" role="alert">{results.message}</p>}
          {results.status === 'ready' && results.data.length > 0 && (
            <ul className="bq-tree" aria-label="Clients trouvés">
              {results.data.filter((c) => c.is_active).map((c) => (
                <li key={c.id} className="bq-row">
                  <span className="bq-grow">{c.name}{c.phone ? <small className="bq-muted"> · {c.phone}</small> : null}</span>
                  <button className="secondary-button" onClick={() => choose(c)}>Choisir</button>
                </li>
              ))}
            </ul>
          )}
          {term.trim() && results.status === 'ready' && results.data.length === 0 && <p className="bq-hint">Aucune fiche : créez-la dans « Clients et crédit ».</p>}
          <p className="bq-hint">Une vente à crédit exige une fiche client (plafond contrôlé par la base).</p>
        </>
      )}
      {error && <p className="bq-error" role="alert">{error}</p>}
      {decision?.kind === 'blocked' && <p className="bq-error" role="alert">{decision.message}</p>}
      {decision?.kind === 'override' && (
        <div className="bq-stack">
          <p className="bq-error" role="alert">Plafond dépassé de {formatMoney(decision.excess)} : autorisation du gérant avec motif.</p>
          <label className="bq-inline-field">Motif d’autorisation
            <input maxLength={300} value={override} onChange={(e) => onOverride(e.target.value)} />
          </label>
          {override && checkOverrideReason(override) && <small className="bq-error">{checkOverrideReason(override)}</small>}
        </div>
      )}
    </div>
  )
}
