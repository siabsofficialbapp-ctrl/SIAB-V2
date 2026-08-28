/**
 * SIAB seed.
 *
 *   pnpm db:seed
 *
 * What it does:
 *   1. Publishes the current Terms & Conditions (English + Arabic).
 *   2. Creates the product categories.
 *   3. Creates ONE demo seller, and wipes any demo products left from a
 *      previous run so repeated seeding does not pile up duplicates.
 *   4. Creates exactly FIVE demo products, uploading a real image for each
 *      and registering the row that points at it — the same two-step flow the
 *      app uses, so a broken storage policy fails here rather than in
 *      production.
 *   5. Teaches the demo seller's Customer AI enough to hold a conversation.
 *
 * Everything it creates is labelled DEMO. It creates no orders, no revenue
 * and no ratings: the analytics dashboard must show real zeros, not invented
 * numbers.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding. See .env.example.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TERMS_VERSION = '2026-08-28.1';
const DEMO_SELLER_EMAIL = 'demo.seller@siab.app';
const DEMO_STALL = 'SIAB Demo Stall';

/** VAT-inclusive prices in halalas — what the buyer pays. */
const DEMO_PRODUCTS = [
  {
    slug: '01-headphones',
    title: 'Wireless Headphones',
    description:
      'Over-ear wireless headphones with active noise cancellation and around 30 hours of battery. '
      + 'Includes a USB-C cable and a carry case. This is a demo listing used to exercise the SIAB marketplace.',
    priceMinor: 34900,
    quantity: 12,
    category: 'electronics',
    minBidMinor: 29900,
  },
  {
    slug: '02-dates',
    title: 'Premium Ajwa Dates 1kg',
    description:
      'One kilogram of Ajwa dates from Madinah, packed in a sealed box. Best kept cool and dry. '
      + 'This is a demo listing used to exercise the SIAB marketplace.',
    priceMinor: 12500,
    quantity: 40,
    category: 'food',
    minBidMinor: 10000,
  },
  {
    slug: '03-oud',
    title: 'Oud Perfume 50ml',
    description:
      'Concentrated oud perfume oil in a 50ml glass bottle. Warm, woody, long lasting. '
      + 'This is a demo listing used to exercise the SIAB marketplace.',
    priceMinor: 48000,
    quantity: 8,
    category: 'beauty',
    minBidMinor: 40000,
  },
  {
    slug: '04-lamp',
    title: 'Brass Desk Lamp',
    description:
      'Adjustable brass desk lamp with a warm LED bulb included. Suits a study or a majlis corner. '
      + 'This is a demo listing used to exercise the SIAB marketplace.',
    priceMinor: 21000,
    quantity: 5,
    category: 'home',
    minBidMinor: null,
  },
  {
    slug: '05-rug',
    title: 'Handwoven Wool Rug 120x180',
    description:
      'Handwoven wool rug, 120cm by 180cm. Natural dyes, slight variation between pieces is expected. '
      + 'This is a demo listing used to exercise the SIAB marketplace.',
    priceMinor: 89000,
    quantity: 3,
    category: 'home',
    minBidMinor: 75000,
  },
] as const;

const CATEGORIES = [
  { slug: 'electronics', name_en: 'Electronics', name_ar: 'إلكترونيات', sort_order: 1 },
  { slug: 'home', name_en: 'Home & Living', name_ar: 'المنزل والمعيشة', sort_order: 2 },
  { slug: 'food', name_en: 'Food & Groceries', name_ar: 'أطعمة وبقالة', sort_order: 3 },
  { slug: 'beauty', name_en: 'Beauty & Fragrance', name_ar: 'العناية والعطور', sort_order: 4 },
  { slug: 'fashion', name_en: 'Fashion', name_ar: 'أزياء', sort_order: 5 },
  { slug: 'vehicles', name_en: 'Vehicles', name_ar: 'مركبات', sort_order: 6 },
  { slug: 'other', name_en: 'Other', name_ar: 'أخرى', sort_order: 99 },
];

/** What the demo seller has taught their Customer AI. */
const AI_KNOWLEDGE = [
  {
    title: 'Delivery and collection',
    category: 'shipping',
    content:
      'We hand over orders in person in Riyadh, usually within two days of the order being confirmed. '
      + 'We meet at a public place agreed in the chat — most buyers choose a shopping centre entrance. '
      + 'We do not currently post items. SIAB is not a delivery company, so the handover is arranged directly between us and the buyer.',
  },
  {
    title: 'Returns',
    category: 'returns',
    content:
      'Buyers may inspect the item at handover before paying. If something is wrong with an item after handover, '
      + 'message us within 7 days and we will replace it or refund it. Perfume and food cannot be returned once the seal is broken, '
      + 'unless the item is faulty.',
  },
  {
    title: 'Payment',
    category: 'policy',
    content:
      'Prices are in Saudi Riyals and already include 15% VAT — the price shown is the price paid. '
      + 'We accept payment at handover. We never ask for payment outside SIAB or for card details in chat.',
  },
  {
    title: 'Offers and haggling',
    category: 'faq',
    content:
      'Most of our listings accept offers. Use the "Make an offer" button rather than asking in chat, '
      + 'so the price is recorded properly. We usually reply to offers within a few hours. '
      + 'Some items have a minimum we will consider, and offers below it are declined automatically.',
  },
  {
    title: 'Headphones — battery and warranty',
    category: 'product',
    content:
      'The wireless headphones last about 30 hours with noise cancellation on, and around 40 hours with it off. '
      + 'They charge over USB-C in roughly 2 hours. They come with a 12 month warranty against manufacturing faults, handled by us directly.',
  },
  {
    title: 'Dates — storage and origin',
    category: 'product',
    content:
      'The Ajwa dates come from Madinah and are packed in a sealed 1kg box. '
      + 'Keep them cool and dry; refrigerate in summer. Best eaten within six months of packing. '
      + 'We can supply larger quantities for events — ask in chat.',
  },
  {
    title: 'Rug — size and care',
    category: 'product',
    content:
      'The wool rug measures 120cm by 180cm. It is handwoven with natural dyes, so slight variation between pieces is normal and not a fault. '
      + 'Vacuum gently and have it professionally cleaned; do not machine wash.',
  },
];

async function publishTerms(): Promise<string> {
  const [bodyEn, bodyAr] = await Promise.all([
    readFile(join(HERE, 'terms-en.md'), 'utf8'),
    readFile(join(HERE, 'terms-ar.md'), 'utf8'),
  ]);

  const { data: existing } = await db
    .from('terms_versions')
    .select('id')
    .eq('version', TERMS_VERSION)
    .maybeSingle();

  if (existing) {
    await db
      .from('terms_versions')
      .update({ body_en: bodyEn, body_ar: bodyAr })
      .eq('id', existing.id);
    console.log(`  terms ${TERMS_VERSION} refreshed`);
    return existing.id as string;
  }

  // Only one version may be current at a time.
  await db.from('terms_versions').update({ is_current: false }).eq('is_current', true);

  const { data, error } = await db
    .from('terms_versions')
    .insert({
      version: TERMS_VERSION,
      body_en: bodyEn,
      body_ar: bodyAr,
      is_current: true,
      requires_reacceptance: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`terms: ${error.message}`);
  console.log(`  terms ${TERMS_VERSION} published`);
  return data.id as string;
}

async function seedCategories(): Promise<Map<string, string>> {
  const { error } = await db.from('categories').upsert(CATEGORIES, { onConflict: 'slug' });
  if (error) throw new Error(`categories: ${error.message}`);
  const { data } = await db.from('categories').select('id, slug');
  console.log(`  ${CATEGORIES.length} categories ready`);
  return new Map((data ?? []).map((c) => [c.slug as string, c.id as string]));
}

async function ensureDemoSeller(): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users.find((u) => u.email === DEMO_SELLER_EMAIL);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: DEMO_SELLER_EMAIL,
      email_confirm: true,
      password: `demo-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      user_metadata: { demo: true },
    });
    if (error || !data.user) throw new Error(`demo seller: ${error?.message}`);
    userId = data.user.id;
  }

  await db.from('profiles').upsert(
    {
      id: userId,
      role: 'seller',
      display_name: 'SIAB Demo Seller',
      email: DEMO_SELLER_EMAIL,
      region: 'Riyadh',
      region_public: true,
    },
    { onConflict: 'id' },
  );

  await db.from('seller_profiles').upsert(
    {
      id: userId,
      stall_name: DEMO_STALL,
      stall_slug: 'siab-demo-stall',
      bio: 'A demonstration stall used to show how SIAB works. Every listing here is a demo product.',
      location_label: 'Riyadh',
      location_public: true,
    },
    { onConflict: 'id' },
  );

  await db.from('seller_ai_settings').upsert(
    {
      seller_id: userId,
      enabled: true,
      tone: 'friendly',
      instructions:
        'You represent a demo stall on SIAB. Be helpful and concise. '
        + 'Always check the live product list before quoting a price. '
        + 'If a buyer asks about anything you have not been taught, say so and suggest they message the seller.',
      greeting_en: 'Hello! I am the assistant for the SIAB Demo Stall. Ask me about any of our products.',
      greeting_ar: 'أهلًا! أنا مساعد بسطة صياب التجريبية. اسألني عن أي من منتجاتنا.',
      fallback_behaviour: 'defer_to_seller',
    },
    { onConflict: 'seller_id' },
  );

  console.log(`  demo seller ready (${userId})`);
  return userId;
}

/**
 * Removes demo products from any earlier run.
 *
 * Deletes the Storage objects too — otherwise repeated seeding leaves orphan
 * files quietly consuming the free tier's storage quota.
 */
async function clearDemoProducts(sellerId: string): Promise<void> {
  const { data: products } = await db.from('products').select('id').eq('seller_id', sellerId);
  const ids = (products ?? []).map((p) => p.id as string);
  if (!ids.length) return;

  const { data: images } = await db.from('product_images').select('storage_path').in('product_id', ids);
  const paths = (images ?? []).map((i) => i.storage_path as string);
  if (paths.length) {
    await db.storage.from('product-images').remove(paths);
  }

  // product_images cascade with the product row.
  await db.from('products').delete().in('id', ids);
  console.log(`  removed ${ids.length} product(s) and ${paths.length} image(s) from a previous run`);
}

async function seedProducts(sellerId: string, categories: Map<string, string>): Promise<void> {
  for (const p of DEMO_PRODUCTS) {
    const { data: product, error } = await db
      .from('products')
      .insert({
        seller_id: sellerId,
        category_id: categories.get(p.category) ?? null,
        title: p.title,
        description: p.description,
        price_minor: p.priceMinor,
        quantity: p.quantity,
        status: 'active',
        allow_bidding: true,
        min_bid_minor: p.minBidMinor,
        location_label: 'Riyadh',
        location_public: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`product ${p.title}: ${error.message}`);

    const productId = product.id as string;
    const bytes = await readFile(join(HERE, 'images', `${p.slug}.jpg`));
    // The first path segment must be the seller id — that is what the
    // Storage policy checks.
    const storagePath = `${sellerId}/${productId}/${p.slug}.jpg`;

    const { error: uploadError } = await db.storage
      .from('product-images')
      .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new Error(`upload ${p.slug}: ${uploadError.message}`);

    // Step two. Without this row the file exists but no product shows a photo.
    const { error: rowError } = await db
      .from('product_images')
      .insert({ product_id: productId, storage_path: storagePath, sort_order: 0 });
    if (rowError) throw new Error(`image row ${p.slug}: ${rowError.message}`);

    console.log(`  ${p.title} — image uploaded and registered`);
  }
}

async function seedKnowledge(sellerId: string): Promise<void> {
  await db.from('seller_ai_knowledge').delete().eq('seller_id', sellerId);
  const { error } = await db.from('seller_ai_knowledge').insert(
    AI_KNOWLEDGE.map((k) => ({
      seller_id: sellerId,
      title: k.title,
      content: k.content,
      category: k.category,
      is_active: true,
    })),
  );
  if (error) throw new Error(`knowledge: ${error.message}`);
  console.log(`  ${AI_KNOWLEDGE.length} knowledge entries taught to the demo assistant`);
}

async function verify(sellerId: string): Promise<void> {
  const { data: products } = await db
    .from('products')
    .select('id, title, product_images ( storage_path )')
    .eq('seller_id', sellerId);

  const missing = (products ?? []).filter((p) => !(p as any).product_images?.length);
  if (missing.length) {
    throw new Error(
      `${missing.length} product(s) have no image row: ${missing.map((m) => m.title).join(', ')}`,
    );
  }

  // Prove the files are genuinely reachable, not just recorded.
  for (const p of products ?? []) {
    const path = (p as any).product_images[0].storage_path as string;
    const { data } = db.storage.from('product-images').getPublicUrl(path);
    const res = await fetch(data.publicUrl, { method: 'HEAD' });
    if (!res.ok) throw new Error(`image for "${p.title}" is not publicly readable (${res.status})`);
  }

  console.log(`  verified: ${products?.length ?? 0} products, all with a reachable image`);
}

async function main(): Promise<void> {
  console.log('Seeding SIAB…');
  await publishTerms();
  const categories = await seedCategories();
  const sellerId = await ensureDemoSeller();
  await clearDemoProducts(sellerId);
  await seedProducts(sellerId, categories);
  await seedKnowledge(sellerId);
  await verify(sellerId);
  console.log('\nDone. Five demo products are live, each with a working image,');
  console.log('and the demo stall\'s assistant knows enough to answer buyers.');
  console.log('No orders, revenue or ratings were created — analytics start at real zero.');
}

main().catch((err) => {
  console.error('\nSeed failed:', (err as Error).message);
  process.exit(1);
});
