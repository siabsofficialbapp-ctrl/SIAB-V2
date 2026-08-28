/**
 * The order lifecycle (§17) and the mutual-confirmation handover that gates
 * the SIAB score.
 *
 * Transitions are validated here AND in the database. This copy exists so the
 * UI can grey out impossible actions; the database copy is the one that
 * actually protects the data.
 */

export type OrderStatus =
  | 'awaiting_payment'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type PaymentStatus =
  | 'unpaid'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cash_on_handover';

/** The pipeline the seller drives, in order. Used to render the tracker. */
export const FULFILMENT_PIPELINE: readonly OrderStatus[] = [
  'confirmed',
  'processing',
  'shipped',
  'delivered',
] as const;

/** Tabs on the seller's orders screen (§17). */
export const ORDER_TABS = ['all', 'confirmed', 'processing', 'shipped', 'delivered'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

type Actor = 'buyer' | 'seller';

/**
 * Who may move an order where.
 *
 * `completed` is deliberately absent: it is never set by an actor. The
 * database sets it when both handover confirmations are present.
 */
const TRANSITIONS: Record<OrderStatus, { to: OrderStatus; by: Actor[] }[]> = {
  awaiting_payment: [
    { to: 'confirmed', by: ['seller'] },
    { to: 'cancelled', by: ['buyer', 'seller'] },
  ],
  confirmed: [
    { to: 'processing', by: ['seller'] },
    { to: 'cancelled', by: ['buyer', 'seller'] },
  ],
  processing: [
    { to: 'shipped', by: ['seller'] },
    { to: 'cancelled', by: ['seller'] },
  ],
  shipped: [{ to: 'delivered', by: ['seller'] }],
  delivered: [],
  completed: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, by: Actor): boolean {
  return (TRANSITIONS[from] ?? []).some((t) => t.to === to && t.by.includes(by));
}

export function nextStatuses(from: OrderStatus, by: Actor): OrderStatus[] {
  return (TRANSITIONS[from] ?? []).filter((t) => t.by.includes(by)).map((t) => t.to);
}

export function isTerminal(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** How far along the pipeline tracker to fill, 0-based. -1 before it starts. */
export function pipelineIndex(status: OrderStatus): number {
  if (status === 'completed') return FULFILMENT_PIPELINE.length - 1;
  return FULFILMENT_PIPELINE.indexOf(status);
}

export interface HandoverState {
  status: OrderStatus;
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
}

/**
 * What SIAB should be asking this person for right now.
 *
 *   'confirm_handover' — we are waiting on them to confirm
 *   'awaiting_other'   — they confirmed; the other side has not
 *   'rate'             — both confirmed, they have not yet rated
 *   'none'             — nothing to do
 */
export function pendingAction(
  order: HandoverState,
  viewer: Actor,
  hasRated: boolean,
): 'confirm_handover' | 'awaiting_other' | 'rate' | 'none' {
  const mine = viewer === 'buyer' ? order.buyerConfirmedAt : order.sellerConfirmedAt;
  const theirs = viewer === 'buyer' ? order.sellerConfirmedAt : order.buyerConfirmedAt;

  if (order.status === 'delivered' || order.status === 'completed') {
    if (!mine) return 'confirm_handover';
    if (!theirs) return 'awaiting_other';
    if (!hasRated) return 'rate';
  }
  return 'none';
}

/** Human-facing order reference, e.g. SIAB-7F3K2Q. Unambiguous characters only. */
export function generateOrderReference(random: () => number = Math.random): string {
  const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return `SIAB-${out}`;
}
