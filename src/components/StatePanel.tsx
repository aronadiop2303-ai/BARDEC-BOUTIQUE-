import type { ReactNode } from 'react'

/** États standard d'un écran : chargement, erreur (avec « Réessayer ») et vide. */
export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <div className="empty-state" role="status"><strong>{label}</strong></div>
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <strong>Une erreur est survenue</strong>
      <span>{message}</span>
      {onRetry && <button className="secondary-button" onClick={onRetry}>Réessayer</button>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{children && <span>{children}</span>}</div>
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav className="bq-pagination" aria-label="Pagination">
      <button className="secondary-button" disabled={page === 0} onClick={() => onPage(page - 1)}>Précédent</button>
      <span>Page {page + 1} sur {pages} · {total} résultat{total > 1 ? 's' : ''}</span>
      <button className="secondary-button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Suivant</button>
    </nav>
  )
}
