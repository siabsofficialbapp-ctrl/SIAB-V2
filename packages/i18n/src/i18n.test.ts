import { test } from 'node:test';
import assert from 'node:assert/strict';

import en from './locales/en.json' with { type: 'json' };
import ar from './locales/ar.json' with { type: 'json' };
import { resolveLocale, isRtl, textDirection, formatDate } from './index.ts';

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      for (const nested of flatten(v, path)) keys.add(nested);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

/**
 * i18next plural suffixes. English uses two forms; Arabic uses six, so the
 * two languages legitimately differ in key COUNT while covering the same
 * message. Comparisons are made on the base key.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

function placeholders(s: string): Set<string> {
  return new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string));
}

function values(obj: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      for (const [nk, nv] of values(v, path)) out.set(nk, nv);
    } else {
      out.set(path, v);
    }
  }
  return out;
}

test('English and Arabic cover the same messages', () => {
  const e = new Set([...flatten(en as Tree)].map(baseKey));
  const a = new Set([...flatten(ar as Tree)].map(baseKey));
  const missing = [...e].filter((k) => !a.has(k));
  const extra = [...a].filter((k) => !e.has(k));
  assert.deepEqual(missing, [], `missing Arabic translations: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `Arabic keys with no English counterpart: ${extra.join(', ')}`);
});

test('every message uses the same placeholders in both languages', () => {
  // Compared per family, because a plural form may legitimately omit the
  // count ("one result" vs "نتيجة واحدة") while the family as a whole uses it.
  const family = (vals: Map<string, string>) => {
    const out = new Map<string, Set<string>>();
    for (const [key, text] of vals) {
      const base = baseKey(key);
      const set = out.get(base) ?? new Set<string>();
      for (const p of placeholders(text)) set.add(p);
      out.set(base, set);
    }
    return out;
  };

  const e = family(values(en as Tree));
  const a = family(values(ar as Tree));

  for (const [key, ep] of e) {
    const ap = a.get(key);
    assert.ok(ap !== undefined, `no Arabic for ${key}`);
    assert.deepEqual(
      [...ep].sort(),
      [...ap].sort(),
      `placeholder mismatch at "${key}": en has ${[...ep]}, ar has ${[...ap]}`,
    );
  }
});

test('Arabic supplies all six plural forms where English pluralises', () => {
  const arKeys = flatten(ar as Tree);
  const enKeys = flatten(en as Tree);
  const pluralBases = new Set(
    [...enKeys].filter((k) => PLURAL_SUFFIX.test(k)).map(baseKey),
  );
  for (const base of pluralBases) {
    for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
      assert.ok(
        arKeys.has(`${base}_${form}`),
        `Arabic is missing the "${form}" plural form of ${base}`,
      );
    }
  }
});

test('no translation is left empty', () => {
  for (const [key, text] of [...values(en as Tree), ...values(ar as Tree)]) {
    assert.ok(text.trim().length > 0, `empty translation at ${key}`);
  }
});

test('locale resolution copes with anything a device reports', () => {
  assert.equal(resolveLocale('ar-SA'), 'ar');
  assert.equal(resolveLocale('ar'), 'ar');
  assert.equal(resolveLocale('AR_sa'), 'ar');
  assert.equal(resolveLocale('en-GB'), 'en');
  assert.equal(resolveLocale('fr-FR'), 'en', 'unsupported locales fall back');
  assert.equal(resolveLocale(null), 'en');
  assert.equal(resolveLocale(''), 'en');
});

test('Arabic is right-to-left, English is not', () => {
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('en'), false);
  assert.equal(textDirection('ar'), 'rtl');
  assert.equal(textDirection('en'), 'ltr');
});

test('dates format in both locales without throwing', () => {
  const iso = '2026-08-28T10:00:00.000Z';
  assert.ok(formatDate(iso, 'en').length > 0);
  assert.ok(formatDate(iso, 'ar').length > 0);
});
