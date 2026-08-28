/**
 * Search, with real filters (§31).
 *
 * Filtering by price range and by SELLER NAME are first-class here, not an
 * afterthought — both were missing from the old search and both are what
 * people actually reach for.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { riyalsToMinor, theme, type Product } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ProductCard } from '../../src/components/ProductCard';
import { Button, EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { useSavedProducts } from '../../src/hooks/useSavedProducts';

type Sort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'score';

interface Filters {
  sellerName: string;
  minPrice: string;
  maxPrice: string;
  sort: Sort;
}

const EMPTY_FILTERS: Filters = { sellerName: '', minPrice: '', maxPrice: '', sort: 'relevance' };

export default function Search() {
  const t = useT();
  const router = useRouter();
  const { savedIds, toggleSave } = useSavedProducts();

  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const activeCount = useMemo(() => {
    let n = 0;
    if (filters.sellerName) n += 1;
    if (filters.minPrice) n += 1;
    if (filters.maxPrice) n += 1;
    if (filters.sort !== 'relevance') n += 1;
    return n;
  }, [filters]);

  const query = useMemo(() => {
    const q: Record<string, string | number | undefined> = { limit: 40, sort: filters.sort };
    if (submitted.trim()) q['q'] = submitted.trim();
    if (filters.sellerName.trim()) q['sellerName'] = filters.sellerName.trim();
    const min = Number(filters.minPrice);
    const max = Number(filters.maxPrice);
    if (filters.minPrice && Number.isFinite(min)) q['minPriceMinor'] = riyalsToMinor(min);
    if (filters.maxPrice && Number.isFinite(max)) q['maxPriceMinor'] = riyalsToMinor(max);
    return q;
  }, [submitted, filters]);

  const hasCriteria = Boolean(submitted.trim() || activeCount > 0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products', 'search', query],
    queryFn: () => apiFetch<{ products: Product[] }>('/products', { anonymous: true, query }),
    enabled: hasCriteria,
  });

  const openFilters = () => { setDraft(filters); setShowFilters(true); };
  const applyFilters = () => { setFilters(draft); setShowFilters(false); };
  const resetFilters = () => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setShowFilters(false); };

  return (
    <View style={styles.container}>
      <Header title={t('nav.search')} />

      <View style={styles.searchBar}>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={theme.color.textMuted} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            onSubmitEditing={() => setSubmitted(term)}
            placeholder={t('market.searchPlaceholder')}
            placeholderTextColor={theme.color.textMuted}
            style={styles.input}
            returnKeyType="search"
          />
          {term ? (
            <Pressable onPress={() => { setTerm(''); setSubmitted(''); }} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={openFilters} style={styles.filterButton} accessibilityRole="button">
          <Ionicons name="options-outline" size={20} color={theme.color.primary} />
          {activeCount > 0 ? (
            <View style={styles.filterCount}>
              <Text style={styles.filterCountText}>{activeCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {!hasCriteria ? (
        <EmptyState icon="search-outline" title={t('market.searchPlaceholder')} />
      ) : isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState messageKey={errorKey(error)} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data?.products ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.resultCount}>
              {t('market.resultCount', { count: data?.products.length ?? 0 })}
            </Text>
          }
          ListEmptyComponent={<EmptyState icon="search-outline" title={t('empty.search')} />}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              saved={savedIds.has(item.id)}
              onToggleSave={() => void toggleSave(item.id)}
              onPress={() => router.push(`/product/${item.id}` as never)}
            />
          )}
        />
      )}

      <FilterSheet
        visible={showFilters}
        draft={draft}
        setDraft={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
        onClose={() => setShowFilters(false)}
      />
    </View>
  );
}

function FilterSheet({ visible, draft, setDraft, onApply, onReset, onClose }: {
  visible: boolean;
  draft: Filters;
  setDraft: (f: Filters) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const SORTS: { value: Sort; key: string }[] = [
    { value: 'relevance', key: 'market.filters.sortRelevance' },
    { value: 'newest', key: 'market.filters.sortNewest' },
    { value: 'price_asc', key: 'market.filters.sortPriceAsc' },
    { value: 'price_desc', key: 'market.filters.sortPriceDesc' },
    { value: 'score', key: 'market.filters.sortScore' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t('market.filters.title')}</Text>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.filterLabel}>{t('market.filters.seller')}</Text>
            <TextInput
              value={draft.sellerName}
              onChangeText={(v) => setDraft({ ...draft, sellerName: v })}
              placeholder={t('market.filters.seller')}
              placeholderTextColor={theme.color.textMuted}
              style={styles.filterInput}
            />

            <Text style={styles.filterLabel}>{t('market.filters.price')}</Text>
            <View style={styles.priceRow}>
              <TextInput
                value={draft.minPrice}
                onChangeText={(v) => setDraft({ ...draft, minPrice: v.replace(/[^0-9.]/g, '') })}
                placeholder={t('market.filters.minPrice')}
                placeholderTextColor={theme.color.textMuted}
                keyboardType="decimal-pad"
                style={[styles.filterInput, styles.priceInput]}
              />
              <Text style={styles.priceDash}>—</Text>
              <TextInput
                value={draft.maxPrice}
                onChangeText={(v) => setDraft({ ...draft, maxPrice: v.replace(/[^0-9.]/g, '') })}
                placeholder={t('market.filters.maxPrice')}
                placeholderTextColor={theme.color.textMuted}
                keyboardType="decimal-pad"
                style={[styles.filterInput, styles.priceInput]}
              />
            </View>

            <Text style={styles.filterLabel}>{t('market.filters.sort')}</Text>
            <View style={styles.sortList}>
              {SORTS.map((s) => (
                <Pressable
                  key={s.value}
                  onPress={() => setDraft({ ...draft, sort: s.value })}
                  style={[styles.sortItem, draft.sort === s.value && styles.sortItemActive]}
                >
                  <Text style={[styles.sortLabel, draft.sort === s.value && styles.sortLabelActive]}>
                    {t(s.key)}
                  </Text>
                  {draft.sort === s.value ? (
                    <Ionicons name="checkmark" size={18} color={theme.color.primary} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={styles.sheetActions}>
            <Button label={t('market.filters.reset')} onPress={onReset} variant="ghost" />
            <Button label={t('common.apply')} onPress={onApply} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.md,
  },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surface,
  },
  input: { flex: 1, paddingVertical: 11, fontSize: theme.fontSize.md, color: theme.color.text },
  filterButton: {
    width: 44, height: 44, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  filterCount: {
    position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: theme.color.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  filterCountText: { color: theme.color.onPrimary, fontSize: 10, fontWeight: '700' },

  list: { padding: theme.spacing.lg, paddingTop: 0, gap: theme.spacing.md },
  row: { gap: theme.spacing.md },
  resultCount: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginBottom: theme.spacing.md },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, maxHeight: '85%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong,
    alignSelf: 'center', marginBottom: theme.spacing.lg,
  },
  sheetTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text, marginBottom: theme.spacing.lg },
  sheetBody: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  filterLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text, marginTop: theme.spacing.sm },
  filterInput: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: 11,
    fontSize: theme.fontSize.md, color: theme.color.text,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  priceInput: { flex: 1 },
  priceDash: { color: theme.color.textMuted },
  sortList: { gap: 4 },
  sortItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md,
  },
  sortItemActive: { backgroundColor: theme.color.primarySubtle },
  sortLabel: { fontSize: theme.fontSize.md, color: theme.color.text },
  sortLabelActive: { color: theme.color.primary, fontWeight: '600' },
  sheetActions: { flexDirection: 'row', gap: theme.spacing.md, paddingTop: theme.spacing.md },
});
