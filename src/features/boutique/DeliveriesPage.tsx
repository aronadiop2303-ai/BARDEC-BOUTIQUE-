import { Truck } from 'lucide-react'
import type { BoutiqueContext } from './context'

/**
 * « Mes livraisons » : le module livraison n'existe pas encore. Aucune donnée n'est inventée :
 * l'écran l'annonce et reste vide.
 */
export default function DeliveriesPage({ ctx }: { ctx: BoutiqueContext }) {
  return (
    <div className="bq-stack">
      <div className="bq-heading"><div><p className="eyebrow">LIVRAISONS</p><h1 className="bq-title">Mes livraisons</h1></div></div>
      <div className="empty-state" role="status">
        <Truck size={22} />
        <strong>Aucune livraison ne vous est assignée.</strong>
        <span>
          Le module livraison n’est pas encore disponible pour {ctx.access.site.name}. Quand il le sera, seules les livraisons
          qui vous sont assignées apparaîtront ici.
        </span>
      </div>
    </div>
  )
}
