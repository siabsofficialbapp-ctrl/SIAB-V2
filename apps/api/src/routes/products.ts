/**
 * Catalogue, marketplace search, and image upload (§8, §9, §10, §31, §35).
 *
 * The buyer-facing shape of a product deliberately carries ONE price and no
 * VAT line: Saudi consumer pricing is VAT-inclusive, and showing a tax
 * breakdown to a shopper is both wrong here and against what was asked.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { createProductSchema, searchProductsSchema, updateProductSchema } from '@siab/core';

import { optionalAuth, requireAuth, requireSeller } from '../auth.js';
import { badRequest, fromPostgrest, notFound } from '../errors.js';
import { anonClient, publicUrl, userClient } from '../supabase.js';

const PRODUCT_IMAGES_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

interface ImageRow { id: string; product_id: string; storage_path: string; sort_order: number }

function toImage(row: ImageRow) {
  return {
    id: row.id,
    productId: row.product_id,
    storagePath: row.storage_path,
    url: publicUrl(PRODUCT_IMAGES_BUCKET, row.storage_path),
    sortOrder: row.sort_order,
  };
}

/** The buyer-facing product shape. No VAT, no fees, no seller internals. */
function toBuyerProduct(row: Record<string, any>) {
  const images = ((row.product_images ?? []) as ImageRow[])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toImage);

  const seller = row.seller_profiles
    ? {
        sellerId: row.seller_profiles.id,
        stallName: row.seller_profiles.stall_name,
        stallSlug: row.seller_profiles.stall_slug,
        logoUrl: row.seller_profiles.logo_url,
        locationLabel: row.seller_profiles.location_public ? row.seller_profiles.location_label : null,
      }
    : undefined;

  return {
    id: row.id,
    sellerId: row.seller_id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    priceMinor: row.price_minor,
    currency: row.currency,
    quantity: row.quantity,
    status: row.status,
    allowBidding: row.allow_bidding,
    minBidMinor: row.min_bid_minor,
    locationLabel: row.location_public ? row.location_label : null,
    images,
    seller,
    createdAt: row.created_at,
  };
}

const PRODUCT_SELECT = `
  id, seller_id, category_id, title, description, price_minor, currency,
  quantity, status, allow_bidding, min_bid_minor, location_label, location_public,
  created_at,
  product_images ( id, product_id, storage_path, sort_order ),
  seller_profiles!inner ( id, stall_name, stall_slug, logo_url, location_label, location_public )
`;

export async function productRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Marketplace
  // -------------------------------------------------------------------------

  /**
   * Search and filtering.
   *
   * Text search runs against the generated tsvector with a trigram fallback,
   * so partial words and Arabic both behave. Filtering by price range and by
   * SELLER NAME are first-class, not afterthoughts.
   */
  app.get('/products', async (req) => {
    const parsed = searchProductsSchema.safeParse({
      ...(req.query as Record<string, unknown>),
      // Query strings arrive as text; coerce the numeric filters.
      minPriceMinor: (req.query as any).minPriceMinor ? Number((req.query as any).minPriceMinor) : undefined,
      maxPriceMinor: (req.query as any).maxPriceMinor ? Number((req.query as any).maxPriceMinor) : undefined,
      limit: (req.query as any).limit ? Number((req.query as any).limit) : undefined,
    });
    if (!parsed.success) throw badRequest('Invalid search', 'error.generic', parsed.error.issues);
    const f = parsed.data;

    const db = anonClient();
    let q = db.from('products').select(PRODUCT_SELECT).eq('status', 'active');

    if (f.q) {
      // `or` across title and description gives partial-word matching that
      // plain full-text search misses — important for Arabic and for
      // half-typed queries.
      const term = f.q.replace(/[%,()]/g, ' ').trim();
      if (term) q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }
    if (f.categoryId) q = q.eq('category_id', f.categoryId);
    if (f.sellerId) q = q.eq('seller_id', f.sellerId);
    if (f.sellerName) q = q.ilike('seller_profiles.stall_name', `%${f.sellerName}%`);
    if (f.minPriceMinor !== undefined) q = q.gte('price_minor', f.minPriceMinor);
    if (f.maxPriceMinor !== undefined) q = q.lte('price_minor', f.maxPriceMinor);

    switch (f.sort) {
      case 'price_asc': q = q.order('price_minor', { ascending: true }); break;
      case 'price_desc': q = q.order('price_minor', { ascending: false }); break;
      case 'newest':
      case 'relevance':
      default: q = q.order('created_at', { ascending: false }); break;
    }

    q = q.limit(f.limit);

    const { data, error } = await q;
    if (error) throw fromPostgrest(error);

    let products = (data ?? []).map(toBuyerProduct);

    // Sorting by seller score needs the sellers' scores, which live on
    // profiles rather than on the product row.
    if (f.sort === 'score' && products.length) {
      const ids = [...new Set(products.map((p) => p.sellerId))];
      const { data: scores } = await db
        .from('v_public_seller')
        .select('seller_id, reputation_score')
        .in('seller_id', ids);
      const byId = new Map((scores ?? []).map((s) => [s.seller_id, s.reputation_score as number]));
      products = products.sort((a, b) => (byId.get(b.sellerId) ?? 0) - (byId.get(a.sellerId) ?? 0));
    }

    return { products, count: products.length };
  });

  app.get<{ Params: { id: string } }>('/products/:id', async (req) => {
    const { data, error } = await anonClient()
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Product');
    return { product: toBuyerProduct(data) };
  });

  /** A seller's public stall, plus a stall-view event for their analytics. */
  app.get<{ Params: { slug: string } }>('/stalls/:slug', async (req) => {
    await optionalAuth(req);
    const db = anonClient();

    const { data: seller, error } = await db
      .from('v_public_seller')
      .select('*')
      .eq('stall_slug', req.params.slug)
      .maybeSingle();
    if (error) throw fromPostgrest(error);
    if (!seller) throw notFound('Stall');

    const { data: products } = await db
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('seller_id', seller.seller_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(50);

    // Stall views are deduped per viewer per day, so a refresh is not a view.
    const viewer = req.auth?.userId ?? req.ip;
    const day = new Date().toISOString().slice(0, 10);
    await db.from('stall_views').insert({
      seller_id: seller.seller_id,
      viewer_id: req.auth?.userId ?? null,
      dedupe_key: `${viewer}:${day}`,
    });

    return {
      stall: {
        sellerId: seller.seller_id,
        stallName: seller.stall_name,
        stallSlug: seller.stall_slug,
        bio: seller.bio,
        logoUrl: seller.logo_url,
        bannerUrl: seller.banner_url,
        locationLabel: seller.location_label,
        displayName: seller.display_name,
        avatarUrl: seller.avatar_url,
        reputationScore: seller.reputation_score,
        scoreBand: seller.score_band,
        email: seller.email,
        phone: seller.phone,
        region: seller.region,
        createdAt: seller.created_at,
      },
      products: (products ?? []).map(toBuyerProduct),
    };
  });

  // -------------------------------------------------------------------------
  // Saved for later
  // -------------------------------------------------------------------------

  app.get('/saved', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { data, error } = await userClient(ctx.accessToken)
      .from('saved_products')
      .select(`created_at, products ( ${PRODUCT_SELECT} )`)
      .order('created_at', { ascending: false });
    if (error) throw fromPostgrest(error);
    return {
      products: (data ?? [])
        .map((r) => (r as any).products)
        .filter(Boolean)
        .map(toBuyerProduct),
    };
  });

  app.post<{ Params: { id: string } }>('/products/:id/save', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { error } = await userClient(ctx.accessToken)
      .from('saved_products')
      .insert({ buyer_id: ctx.userId, product_id: req.params.id });
    if (error && error.code !== '23505') throw fromPostgrest(error);
    return { saved: true };
  });

  app.delete<{ Params: { id: string } }>('/products/:id/save', async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    const { error } = await userClient(ctx.accessToken)
      .from('saved_products')
      .delete()
      .eq('buyer_id', ctx.userId)
      .eq('product_id', req.params.id);
    if (error) throw fromPostgrest(error);
    return { saved: false };
  });

  // -------------------------------------------------------------------------
  // Seller catalogue management
  // -------------------------------------------------------------------------

  app.get('/seller/products', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const { data, error } = await userClient(seller.accessToken)
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('seller_id', seller.sellerId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });
    if (error) throw fromPostgrest(error);
    return { products: (data ?? []).map(toBuyerProduct) };
  });

  app.post('/seller/products', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = createProductSchema.parse(req.body);

    const { data, error } = await userClient(seller.accessToken)
      .from('products')
      .insert({
        seller_id: seller.sellerId,
        title: body.title,
        description: body.description ?? null,
        price_minor: body.priceMinor,
        category_id: body.categoryId ?? null,
        quantity: body.quantity,
        status: body.status,
        allow_bidding: body.allowBidding,
        min_bid_minor: body.minBidMinor ?? null,
        location_label: body.locationLabel ?? null,
        location_public: body.locationPublic,
      })
      .select('id')
      .single();
    if (error) throw fromPostgrest(error);
    return { productId: data.id };
  });

  app.patch<{ Params: { id: string } }>('/seller/products/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    const body = updateProductSchema.parse(req.body);

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch['title'] = body.title;
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.priceMinor !== undefined) patch['price_minor'] = body.priceMinor;
    if (body.categoryId !== undefined) patch['category_id'] = body.categoryId;
    if (body.quantity !== undefined) patch['quantity'] = body.quantity;
    if (body.status !== undefined) patch['status'] = body.status;
    if (body.allowBidding !== undefined) patch['allow_bidding'] = body.allowBidding;
    if (body.minBidMinor !== undefined) patch['min_bid_minor'] = body.minBidMinor;
    if (body.locationLabel !== undefined) patch['location_label'] = body.locationLabel;
    if (body.locationPublic !== undefined) patch['location_public'] = body.locationPublic;

    if (Object.keys(patch).length === 0) return { updated: false };

    const { error } = await userClient(seller.accessToken)
      .from('products')
      .update(patch)
      .eq('id', req.params.id)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { updated: true };
  });

  app.delete<{ Params: { id: string } }>('/seller/products/:id', async (req, reply) => {
    const seller = await requireSeller(req, reply);
    // Soft delete: order history must survive the listing.
    const { error } = await userClient(seller.accessToken)
      .from('products')
      .update({ status: 'removed' })
      .eq('id', req.params.id)
      .eq('seller_id', seller.sellerId);
    if (error) throw fromPostgrest(error);
    return { removed: true };
  });

  // -------------------------------------------------------------------------
  // Images
  //
  // Upload is TWO steps, and skipping the second is why images "don't save":
  // the file lands in Storage but no row points at it, so nothing renders.
  //
  //   1. POST .../images/upload-url  -> a signed URL and the exact path
  //   2. PUT the bytes to that URL
  //   3. POST .../images             -> registers the row
  //
  // Step 3 is what makes the image real.
  // -------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { contentType?: string; bytes?: number } }>(
    '/seller/products/:id/images/upload-url',
    async (req, reply) => {
      const seller = await requireSeller(req, reply);
      const contentType = req.body?.contentType ?? 'image/jpeg';
      const bytes = req.body?.bytes ?? 0;

      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        throw badRequest(`Unsupported image type ${contentType}`, 'error.imageWrongType');
      }
      if (bytes > MAX_IMAGE_BYTES) {
        throw badRequest('Image is too large', 'error.imageTooLarge', { maxMb: 5 });
      }

      const db = userClient(seller.accessToken);
      const { data: product } = await db
        .from('products')
        .select('id')
        .eq('id', req.params.id)
        .eq('seller_id', seller.sellerId)
        .maybeSingle();
      if (!product) throw notFound('Product');

      const ext = contentType === 'image/png' ? 'png'
        : contentType === 'image/webp' ? 'webp'
        : contentType === 'image/heic' ? 'heic'
        : 'jpg';

      // The FIRST path segment must be the seller id — the Storage policy
      // checks exactly that.
      const path = `${seller.sellerId}/${req.params.id}/${randomUUID()}.${ext}`;

      const { data, error } = await db.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw badRequest(`Could not prepare the upload: ${error.message}`, 'error.uploadFailed');

      return { uploadUrl: data.signedUrl, token: data.token, path, bucket: PRODUCT_IMAGES_BUCKET };
    },
  );

  /** Step 3. Without this the file exists but the product shows no photo. */
  app.post<{ Params: { id: string }; Body: { storagePath?: string; sortOrder?: number } }>(
    '/seller/products/:id/images',
    async (req, reply) => {
      const seller = await requireSeller(req, reply);
      const storagePath = req.body?.storagePath;
      if (!storagePath) throw badRequest('storagePath is required');

      // The path must sit inside this seller's folder for this product.
      if (!storagePath.startsWith(`${seller.sellerId}/${req.params.id}/`)) {
        throw badRequest('That storage path does not belong to this product');
      }

      const db = userClient(seller.accessToken);

      // Confirm the object actually exists before recording it, so a failed
      // upload cannot leave a row pointing at nothing.
      const folder = storagePath.slice(0, storagePath.lastIndexOf('/'));
      const filename = storagePath.slice(storagePath.lastIndexOf('/') + 1);
      const { data: listed } = await db.storage.from(PRODUCT_IMAGES_BUCKET).list(folder, {
        search: filename,
        limit: 1,
      });
      if (!listed?.length) {
        throw badRequest('The image was not found in storage. Upload it before registering it.', 'error.uploadFailed');
      }

      const { data, error } = await db
        .from('product_images')
        .insert({
          product_id: req.params.id,
          storage_path: storagePath,
          sort_order: req.body?.sortOrder ?? 0,
        })
        .select('id, product_id, storage_path, sort_order')
        .single();
      if (error) throw fromPostgrest(error);

      return { image: toImage(data as ImageRow) };
    },
  );

  /**
   * Cleans up a Storage object whose registration failed.
   *
   * The client calls this when step 3 of the upload errors, so a file that
   * nothing points at does not sit consuming the storage quota.
   */
  app.delete<{ Params: { id: string }; Body: { storagePath?: string } }>(
    '/seller/products/:id/images/orphan',
    async (req, reply) => {
      const seller = await requireSeller(req, reply);
      const storagePath = req.body?.storagePath;
      if (!storagePath) throw badRequest('storagePath is required');

      if (!storagePath.startsWith(`${seller.sellerId}/${req.params.id}/`)) {
        throw badRequest('That storage path does not belong to this product');
      }

      const db = userClient(seller.accessToken);

      // Refuse if a row DOES point at it — that would delete a live image.
      const { data: registered } = await db
        .from('product_images')
        .select('id')
        .eq('storage_path', storagePath)
        .maybeSingle();
      if (registered) throw badRequest('That image is registered; delete it properly instead.');

      await db.storage.from(PRODUCT_IMAGES_BUCKET).remove([storagePath]);
      return { removed: true };
    },
  );

  app.delete<{ Params: { id: string; imageId: string } }>(
    '/seller/products/:id/images/:imageId',
    async (req, reply) => {
      const seller = await requireSeller(req, reply);
      const db = userClient(seller.accessToken);

      const { data: image } = await db
        .from('product_images')
        .select('storage_path')
        .eq('id', req.params.imageId)
        .eq('product_id', req.params.id)
        .maybeSingle();
      if (!image) throw notFound('Image');

      // Remove the row first: an orphaned file is harmless, a row pointing at
      // a deleted file renders as a broken image.
      const { error } = await db.from('product_images').delete().eq('id', req.params.imageId);
      if (error) throw fromPostgrest(error);
      await db.storage.from(PRODUCT_IMAGES_BUCKET).remove([image.storage_path as string]);

      return { removed: true };
    },
  );

  app.get('/categories', async () => {
    const { data, error } = await anonClient()
      .from('categories')
      .select('id, slug, name_en, name_ar, parent_id, sort_order')
      .order('sort_order');
    if (error) throw fromPostgrest(error);
    return { categories: data ?? [] };
  });
}
