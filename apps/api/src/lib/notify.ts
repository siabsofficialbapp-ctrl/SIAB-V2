/**
 * Notifications (§26).
 *
 * Rows store translation KEYS and params, never rendered English. The
 * recipient may switch language after the notification is written, and it
 * must still read correctly.
 *
 * Written with the service client because a notification is, by definition,
 * a row you create for somebody else.
 */
import { serviceClient } from '../supabase.js';

export type NotificationKind =
  | 'message'
  | 'bid_received'
  | 'bid_accepted'
  | 'bid_rejected'
  | 'bid_countered'
  | 'order_placed'
  | 'order_status'
  | 'handover_confirm_required'
  | 'reputation_received'
  | 'system';

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  target?: { screen: string; id?: string };
}

export async function notify(input: NotifyInput): Promise<void> {
  const { error } = await serviceClient().from('notifications').insert({
    user_id: input.userId,
    kind: input.kind,
    title_key: input.titleKey,
    body_key: input.bodyKey,
    params: input.params ?? {},
    target: input.target ?? null,
  });
  // A failed notification must never fail the action that triggered it. The
  // order is placed; the bell icon is secondary.
  if (error) console.error('[notify] failed:', error.message);
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  await Promise.all(inputs.map(notify));
}
