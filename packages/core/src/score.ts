/**
 * The SIAB score.
 *
 * Replaces star ratings entirely. Every member — buyer and seller — starts at
 * 100. After an order completes, each party may move the other by +5, -5, or
 * skip. The number sits beside the member's name, coloured by band.
 *
 * The thresholds here MUST match `siab_score_band()` in
 * supabase/migrations/0002_profiles.sql. The database is authoritative; this
 * is the client-side mirror used for rendering.
 */

export const STARTING_SCORE = 100;
export const SCORE_STEP = 5;
export const DIAMOND_THRESHOLD = 501;

export type ScoreBand = 'red' | 'orange' | 'green' | 'diamond';

export function scoreBand(score: number): ScoreBand {
  if (score < 60) return 'red';
  if (score <= 150) return 'orange';
  if (score <= 500) return 'green';
  return 'diamond';
}

/** Hex colours for each band. Diamond is the brand cyan. */
export const SCORE_BAND_COLOR: Record<ScoreBand, string> = {
  red: '#DC2626',
  orange: '#F97316',
  green: '#16A34A',
  diamond: '#06B6D4',
};

/** i18n key for the band label, so it translates rather than hard-coding text. */
export function scoreBandLabelKey(band: ScoreBand): string {
  return `score.band.${band}`;
}

export function isDiamond(score: number): boolean {
  return score >= DIAMOND_THRESHOLD;
}

/** A rating is one of exactly three actions. */
export type ReputationDelta = 5 | -5 | 0;

export function applyDelta(score: number, delta: ReputationDelta): number {
  return Math.max(0, score + delta);
}

/**
 * Whether the rating window is open for a given order, from the viewer's side.
 * Mirrors the database rule: both parties must have confirmed the handover.
 */
export function canRate(order: {
  status: string;
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
}): boolean {
  return (
    order.status === 'completed' &&
    order.sellerConfirmedAt !== null &&
    order.buyerConfirmedAt !== null
  );
}
