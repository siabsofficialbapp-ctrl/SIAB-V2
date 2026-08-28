/**
 * "Save for later" — the buyer's own place to keep products.
 */
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { theme } from '@siab/core';

import { Header } from '../../src/components/Header';
import { ProductCard } from '../../src/components/ProductCard';
import { EmptyState } from '../../src/components/ui';
import { useT } from '../../src/hooks/useT';
import { useSavedProducts } from '../../src/hooks/useSavedProducts';

export default function Saved() {
  const t = useT();
  const router = useRouter();
  const { saved, savedIds, toggleSave } = useSavedProducts();

  return (
    <View style={styles.container}>
      <Header title={t('nav.saved')} />
      <FlatList
        data={saved}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState icon="bookmark-outline" title={t('empty.saved')} />}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            saved={savedIds.has(item.id)}
            onToggleSave={() => void toggleSave(item.id)}
            onPress={() => router.push(`/product/${item.id}` as never)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { gap: theme.spacing.md },
});
