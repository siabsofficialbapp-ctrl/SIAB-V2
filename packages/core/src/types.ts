/**
 * Domain types mirroring the database. Kept hand-written rather than
 * generated so the shape the app relies on is explicit and reviewable.
 */
import type { ScoreBand } from './score.js';
import type { OrderStatus, PaymentStatus } from './orders.js';

export type Role = 'buyer' | 'seller';
export type Locale = 'en' | 'ar';

export interface Profile {
  id: string;
  role: Role;
  displayName: string;
  avatarUrl: string | null;
  locale: Locale;
  email: string | null;
  phone: string | null;
  region: string | null;
  emailPublic: boolean;
  phonePublic: boolean;
  regionPublic: boolean;
  reputationScore: number;
  createdAt: string;
}

/**
 * What anyone is allowed to see of another member. Contact fields are already
 * nulled out by the database view when the member has not opted in, so a
 * client cannot accidentally render something private.
 */
export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  reputationScore: number;
  scoreBand: ScoreBand;
  email: string | null;
  phone: string | null;
  region: string | null;
  createdAt: string;
}

export interface PublicSeller extends PublicProfile {
  sellerId: string;
  stallName: string;
  stallSlug: string;
  bio: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  locationLabel: string | null;
}

export interface ProductImage {
  id: string;
  productId: string;
  storagePath: string;
  /** Resolved public URL. Built by the API, never assembled in the UI. */
  url: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  sellerId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  /** VAT-inclusive. The only price a buyer is shown. */
  priceMinor: number;
  currency: 'SAR';
  quantity: number;
  status: 'draft' | 'active' | 'paused' | 'sold_out' | 'removed';
  allowBidding: boolean;
  minBidMinor: number | null;
  locationLabel: string | null;
  images: ProductImage[];
  seller?: PublicSeller;
  createdAt: string;
}

export interface Bid {
  id: string;
  productId: string;
  buyerId: string;
  sellerId: string;
  amountMinor: number;
  quantity: number;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired' | 'cancelled';
  counterMinor: number | null;
  expiresAt: string;
  createdAt: string;
}

export interface Order {
  id: string;
  reference: string;
  buyerId: string;
  sellerId: string;
  productId: string | null;
  productTitle: string;
  quantity: number;
  totalMinor: number;
  /** Seller-facing only. The buyer's API responses omit these. */
  vatMinor?: number;
  platformFeeMinor?: number;
  currency: 'SAR';
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  sellerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
  completedAt: string | null;
  handoverLabel: string | null;
  createdAt: string;
  counterparty?: PublicProfile;
  /** Set when the viewer has already filed their rating for this order. */
  viewerHasRated?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: 'text' | 'image' | 'location';
  body: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  kind: 'human' | 'ai';
  buyerId: string;
  sellerId: string;
  productId: string | null;
  lastMessageAt: string | null;
  counterparty?: PublicProfile | PublicSeller;
  unreadCount?: number;
}

/** Every number here is computed from real rows. Nothing is stored. */
export interface SellerAnalytics {
  sellerId: string;
  revenueMinor: number;
  vatMinor: number;
  platformFeeMinor: number;
  costsMinor: number;
  netProfitMinor: number;
  completedOrders: number;
  averageOrderMinor: number;
  buyerConversations: number;
  stallViews: number;
  activeProducts: number;
  reputationScore: number;
  scoreBand: ScoreBand;
}

export interface Notification {
  id: string;
  kind: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown>;
  target: { screen: string; id?: string } | null;
  readAt: string | null;
  createdAt: string;
}
