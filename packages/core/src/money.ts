/**
 * Money in SIAB is always an integer count of halalas (1 SAR = 100 halalas),
 * carried in `bigint`-backed database columns and `number` in TypeScript.
 *
 * Floats are never used for money. 0.1 + 0.2 !== 0.3, and a marketplace that
 * rounds badly loses real money and real trust.
 */

export const CURRENCY = 'SAR' as const;
export type Currency = typeof CURRENCY;

/** Saudi VAT, in basis points. 1500 = 15%. */
export const VAT_BPS = 1500;

/** SIAB's commission on a sale, in basis points. 100 = 1%. */
export const PLATFORM_FEE_BPS = 100;

const MINOR_PER_MAJOR = 100;

export function riyalsToMinor(riyals: number): number {
  if (!Number.isFinite(riyals)) throw new RangeError('amount must be finite');
  return Math.round(riyals * MINOR_PER_MAJOR);
}

export function minorToRiyals(minor: number): number {
  return minor / MINOR_PER_MAJOR;
}

/**
 * Prices shown to buyers are VAT-INCLUSIVE — Saudi consumer-pricing rules
 * require the displayed price to be the price paid. So VAT is extracted out
 * of the total rather than added on top of it.
 *
 *   vat = total × rate / (1 + rate)
 */
export function vatFromInclusive(totalMinor: number, bps: number = VAT_BPS): number {
  if (totalMinor < 0) throw new RangeError('total must not be negative');
  return Math.round((totalMinor * bps) / (10_000 + bps));
}

/** The seller's share before VAT, given a VAT-inclusive total. */
export function netOfVat(totalMinor: number, bps: number = VAT_BPS): number {
  return totalMinor - vatFromInclusive(totalMinor, bps);
}

/** SIAB's commission, charged on the VAT-inclusive total. */
export function platformFee(totalMinor: number, bps: number = PLATFORM_FEE_BPS): number {
  if (totalMinor < 0) throw new RangeError('total must not be negative');
  return Math.round((totalMinor * bps) / 10_000);
}

export interface OrderTotals {
  /** What the buyer pays. The only number a buyer ever sees. */
  totalMinor: number;
  /** VAT contained within the total. Seller-facing only. */
  vatMinor: number;
  /** SIAB's commission. Seller-facing only. */
  platformFeeMinor: number;
  /** What reaches the seller before their own costs. Seller-facing only. */
  sellerNetMinor: number;
}

/**
 * The full breakdown of an order. Buyers are shown `totalMinor` and nothing
 * else; the rest exists for the seller's books and analytics.
 */
export function computeOrderTotals(
  unitPriceMinor: number,
  quantity = 1,
  opts: { vatBps?: number; feeBps?: number } = {},
): OrderTotals {
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new RangeError('unit price must be a non-negative integer of halalas');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive integer');
  }
  const totalMinor = unitPriceMinor * quantity;
  const vatMinor = vatFromInclusive(totalMinor, opts.vatBps ?? VAT_BPS);
  const platformFeeMinor = platformFee(totalMinor, opts.feeBps ?? PLATFORM_FEE_BPS);
  return {
    totalMinor,
    vatMinor,
    platformFeeMinor,
    sellerNetMinor: totalMinor - vatMinor - platformFeeMinor,
  };
}

/**
 * Formats money for display. Arabic renders with Arabic-Indic digits and the
 * riyal symbol placed per locale convention — `Intl` handles both.
 */
export function formatMoney(minor: number, locale: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
  }).format(minorToRiyals(minor));
}
