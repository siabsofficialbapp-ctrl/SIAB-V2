/**
 * A product in a list.
 *
 * Shows ONE price — the VAT-inclusive figure the buyer pays. No tax
 * breakdown appears anywhere a buyer can see.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, theme, type Product } from '@siab/core';

import { useLocaleInfo, useT } from '../hooks/useT';
import { ScoreBadge } from './ScoreBadge';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
  onToggleSave?: () => void;
  saved?: boolean;
}

export function ProductCard({ product, onPress, onToggleSave, saved }: ProductCardProps) {
  const t = useT();
  const { locale } = useLocaleInfo();
  const image = product.images[0];
  const outOfStock = product.quantity <= 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.imageWrap}>
        {image ? (
          <Image source={{ uri: image.url }} style={styles.image} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={28} color={theme.color.textMuted} />
          </View>
        )}

        {onToggleSave ? (
          <Pressable
            onPress={(e) => { e.stopPropagation(); onToggleSave(); }}
            hitSlop={8}
            style={styles.saveButton}
            accessibilityRole="button"
            accessibilityLabel={saved ? t('product.unsave') : t('product.save')}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={saved ? theme.color.primary : theme.color.text}
            />
          </Pressable>
        ) : null}

        {outOfStock ? (
          <View style={styles.soldOut}>
            <Text style={styles.soldOutText}>{t('product.soldOut')}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{product.title}</Text>
        {/* One price. VAT is already inside it. */}
        <Text style={styles.price}>{formatMoney(product.priceMinor, locale)}</Text>

        {product.seller ? (
          <View style={styles.sellerRow}>
            <Text style={styles.stall} numberOfLines={1}>{product.seller.stallName}</Text>
            {'reputationScore' in product.seller && typeof product.seller.reputationScore === 'number' ? (
              <ScoreBadge score={product.seller.reputationScore} size="sm" />
            ) : null}
          </View>
        ) : null}

        {product.locationLabel ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color={theme.color.textMuted} />
            <Text style={styles.location} numberOfLines={1}>{product.locationLabel}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.9, borderColor: theme.color.primary },
  imageWrap: { position: 'relative', aspectRatio: 1, backgroundColor: theme.color.surfaceMuted },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  saveButton: {
    position: 'absolute', top: 8, right: 8,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  soldOut: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.72)', paddingVertical: 4, alignItems: 'center',
  },
  soldOutText: { color: theme.color.textInverse, fontSize: theme.fontSize.xs, fontWeight: '600' },
  body: { padding: theme.spacing.md, gap: 4 },
  title: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text, lineHeight: 19 },
  price: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.primary },
  sellerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  stall: { flex: 1, fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  location: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
});
