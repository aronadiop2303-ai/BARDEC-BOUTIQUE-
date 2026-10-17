import { formatMoney } from '../../domain/hardware/money'
import { formatQuantity } from '../../domain/hardware/units'
import { legalMentions, type ReceiptSnapshot } from '../../domain/pos/receipt'

export type ReceiptFormat = 'ticket' | 'a4'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Dakar' })

/**
 * Reçu imprimable, rendu UNIQUEMENT à partir de l'instantané figé (content_snapshot).
 * Aucun montant n'est recalculé : les valeurs sont seulement mises en forme.
 * Aucune taxe n'est calculée ni affichée, aucune conformité fiscale n'est revendiquée.
 */
export default function Receipt({ snapshot, format, voided = false }: { snapshot: ReceiptSnapshot; format: ReceiptFormat; voided?: boolean }) {
  const { shop, settings, totals, cash } = snapshot
  const currency = totals.currency
  const money = (value: number) => formatMoney(value, currency)
  const mentions = legalMentions(settings.legal_details)
  const showCashier = settings.show_cashier_name !== false && !!snapshot.cashier?.name
  const showCustomer = settings.show_customer_details !== false && !!snapshot.customer && (!!snapshot.customer.name || !!snapshot.customer.phone)
  const title = format === 'a4' ? 'Reçu de vente' : 'Ticket de caisse'

  return (
    <article className={format === 'a4' ? 'receipt receipt-a4' : 'receipt receipt-ticket'} aria-label={`${title} ${snapshot.document.number}`}>
      <style>{format === 'a4' ? '@page { size: A4; margin: 15mm; }' : '@page { size: 80mm auto; margin: 4mm; }'}</style>
      {voided && <p className="receipt-void" role="status">ANNULÉ</p>}
      <header className="receipt-head">
        <strong className="receipt-shop">{shop.name}</strong>
        {shop.legal_name && <span>{shop.legal_name}</span>}
        {(shop.address || shop.city) && <span>{[shop.address, shop.city].filter(Boolean).join(', ')}</span>}
        {shop.phone && <span>Tél. {shop.phone}</span>}
        {shop.email && format === 'a4' && <span>{shop.email}</span>}
        {mentions.map((m) => <span key={m.label}>{m.label} : {m.value}</span>)}
      </header>

      <dl className="receipt-meta">
        <div><dt>{title}</dt><dd>{snapshot.document.number}</dd></div>
        <div><dt>Date</dt><dd>{dateFormat.format(new Date(snapshot.document.issued_at))}</dd></div>
        {showCashier && <div><dt>Caissier</dt><dd>{snapshot.cashier.name}</dd></div>}
        {showCustomer && <div><dt>Client</dt><dd>{[snapshot.customer?.name, snapshot.customer?.phone].filter(Boolean).join(' · ')}</dd></div>}
      </dl>

      <table className="receipt-lines">
        <thead>
          <tr><th scope="col">Article</th><th scope="col" className="num">Montant</th></tr>
        </thead>
        <tbody>
          {snapshot.lines.map((line, index) => (
            <tr key={index}>
              <td>
                <span className="receipt-item">{line.name}</span>
                <small>{formatQuantity(line.quantity)} {line.unit_label ?? ''} × {money(line.unit_price)}</small>
                {line.line_discount > 0 && <small>Remise : −{money(line.line_discount)}</small>}
              </td>
              <td className="num">{money(line.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="receipt-totals">
        {totals.discount_total > 0 && <div><dt>Sous-total</dt><dd>{money(totals.subtotal)}</dd></div>}
        {totals.discount_total > 0 && <div><dt>Remise</dt><dd>−{money(totals.discount_total)}</dd></div>}
        <div className="receipt-grand"><dt>TOTAL</dt><dd>{money(totals.grand_total)}</dd></div>
      </dl>

      <dl className="receipt-payments" aria-label="Paiement">
        {snapshot.payments.map((payment, index) => (
          <div key={index}>
            <dt>{payment.label}{payment.reference ? ` (${payment.reference})` : ''}</dt>
            <dd>{money(payment.amount)}</dd>
          </div>
        ))}
        {cash.tendered > 0 && <div><dt>Espèces remises</dt><dd>{money(cash.tendered)}</dd></div>}
        {cash.tendered > 0 && <div><dt>Monnaie rendue</dt><dd>{money(cash.change)}</dd></div>}
      </dl>

      {settings.footer_text && <p className="receipt-footer">{settings.footer_text}</p>}
    </article>
  )
}
