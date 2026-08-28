/**
 * Request/response contracts, shared by the API and both clients.
 *
 * Every API route validates its body against the schema here. Validation is
 * never left to the client: these run server-side, and the client imports the
 * same definitions only so its forms agree with the server.
 */
import { z } from 'zod';

export const uuid = z.string().uuid();
export const localeSchema = z.enum(['en', 'ar']);
export const roleSchema = z.enum(['buyer', 'seller']);

/** E.164. Saudi mobiles are +9665XXXXXXXX. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in international format, e.g. +966501234567');

/** Money arrives as halalas: a non-negative integer. */
export const minorAmount = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const acceptTermsSchema = z.object({
  termsVersionId: uuid,
});

/**
 * Role selection. A seller MUST supply a stall name — there is no seller
 * account without one.
 */
export const chooseRoleSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('buyer'),
    displayName: z.string().trim().min(2).max(60),
  }),
  z.object({
    role: z.literal('seller'),
    displayName: z.string().trim().min(2).max(60),
    stallName: z.string().trim().min(2).max(60),
  }),
]);

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  avatarUrl: z.string().url().nullish(),
  locale: localeSchema.optional(),
  phone: phoneSchema.nullish(),
  region: z.string().trim().max(80).nullish(),
  emailPublic: z.boolean().optional(),
  phonePublic: z.boolean().optional(),
  regionPublic: z.boolean().optional(),
});

/**
 * Changing an email address is a separate, verified flow — it updates the
 * auth record first and only then the profile mirror. It is deliberately not
 * part of updateProfileSchema.
 */
export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email(),
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const productStatusSchema = z.enum(['draft', 'active', 'paused', 'sold_out', 'removed']);

export const createProductSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(5000).optional(),
  /** VAT-inclusive price in halalas — the number the buyer sees. */
  priceMinor: minorAmount,
  categoryId: uuid.nullish(),
  quantity: z.number().int().min(0).default(1),
  status: productStatusSchema.default('draft'),
  allowBidding: z.boolean().default(true),
  minBidMinor: minorAmount.nullish(),
  locationLabel: z.string().trim().max(120).nullish(),
  locationPublic: z.boolean().default(false),
});

export const updateProductSchema = createProductSchema.partial();

/** Marketplace search and filtering (§31). */
export const searchProductsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: uuid.optional(),
  /** Filter by stall name — sellers are searchable by name, not just id. */
  sellerName: z.string().trim().max(60).optional(),
  sellerId: uuid.optional(),
  minPriceMinor: minorAmount.optional(),
  maxPriceMinor: minorAmount.optional(),
  region: z.string().trim().max(80).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'score']).default('relevance'),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export const placeBidSchema = z.object({
  productId: uuid,
  amountMinor: minorAmount.refine((v) => v > 0, 'offer must be greater than zero'),
  quantity: z.number().int().min(1).default(1),
  message: z.string().trim().max(500).optional(),
});

export const respondToBidSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('counter'), counterMinor: minorAmount }),
]);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const createOrderSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).default(1),
  /** Present when the order comes from an accepted offer. */
  bidId: uuid.optional(),
  handoverLabel: z.string().trim().max(200).optional(),
});

export const advanceOrderSchema = z.object({
  to: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
  note: z.string().trim().max(300).optional(),
});

/** "I gave it" / "I received it". */
export const confirmHandoverSchema = z.object({
  orderId: uuid,
});

/** +5, -5, or skip. Nothing else is a valid rating. */
export const rateOrderSchema = z.object({
  orderId: uuid,
  delta: z.union([z.literal(5), z.literal(-5), z.literal(0)]),
});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), body: z.string().trim().min(1).max(4000) }),
  z.object({ kind: z.literal('image'), storagePath: z.string().min(1) }),
  z.object({
    kind: z.literal('location'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().trim().max(200).optional(),
  }),
]);

export const startConversationSchema = z.object({
  sellerId: uuid,
  productId: uuid.optional(),
  kind: z.enum(['human', 'ai']).default('human'),
});

// ---------------------------------------------------------------------------
// Seller AI
// ---------------------------------------------------------------------------

export const aiToneSchema = z.enum(['friendly', 'professional', 'concise', 'detailed', 'casual']);

export const updateAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  tone: aiToneSchema.optional(),
  instructions: z.string().trim().max(4000).nullish(),
  greetingEn: z.string().trim().max(500).nullish(),
  greetingAr: z.string().trim().max(500).nullish(),
  fallbackBehaviour: z.enum(['defer_to_seller', 'say_unknown']).optional(),
});

export const upsertKnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  category: z.enum(['faq', 'policy', 'shipping', 'returns', 'product', 'other']).default('other'),
  isActive: z.boolean().default(true),
});

export const askCustomerAiSchema = z.object({
  sellerId: uuid,
  productId: uuid.optional(),
  message: z.string().trim().min(1).max(2000),
  conversationId: uuid.optional(),
});

export const askCoworkerSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: uuid.optional(),
});

// ---------------------------------------------------------------------------
// Costs (so "net profit" is a real number)
// ---------------------------------------------------------------------------

export const createCostSchema = z.object({
  label: z.string().trim().min(1).max(200),
  amountMinor: minorAmount,
  orderId: uuid.nullish(),
  incurredOn: z.string().date().optional(),
});

export type ChooseRoleInput = z.infer<typeof chooseRoleSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type SearchProductsInput = z.infer<typeof searchProductsSchema>;
export type PlaceBidInput = z.infer<typeof placeBidSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type RateOrderInput = z.infer<typeof rateOrderSchema>;
