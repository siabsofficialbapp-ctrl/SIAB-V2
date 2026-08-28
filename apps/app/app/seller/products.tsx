/**
 * The seller's catalogue, with the create/edit sheet and photo upload.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { formatMoney, minorToRiyals, riyalsToMinor, theme, type Product } from '@siab/core';

import { Header } from '../../src/components/Header';
import { Button, Card, EmptyState, ErrorState, Field, LoadingState } from '../../src/components/ui';
import { useLocaleInfo, useT } from '../../src/hooks/useT';
import { apiFetch, errorKey } from '../../src/lib/api';
import { uploadProductImage } from '../../src/lib/upload';

export default function SellerProducts() {
  const t = useT();
  const { locale } = useLocaleInfo();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Product | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['seller', 'products'],
    queryFn: () => apiFetch<{ products: Product[] }>('/seller/products'),
  });

  const openNew = () => {
    setEditing(null); setTitle(''); setDescription(''); setPrice(''); setQuantity('1');
    setError(null); setShowEditor(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setTitle(p.title);
    setDescription(p.description ?? '');
    setPrice(String(minorToRiyals(p.priceMinor)));
    setQuantity(String(p.quantity));
    setError(null);
    setShowEditor(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        priceMinor: riyalsToMinor(Number(price)),
        quantity: Number(quantity),
        status: 'active' as const,
      };
      if (editing) {
        await apiFetch(`/seller/products/${editing.id}`, { method: 'PATCH', body });
        return editing.id;
      }
      const res = await apiFetch<{ productId: string }>('/seller/products', { method: 'POST', body });
      return res.productId;
    },
    onSuccess: () => {
      setShowEditor(false);
      void queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(errorKey(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/seller/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  /** Pick, upload, and register — all three steps, or the photo never shows. */
  const addPhoto = async (productId: string, sortOrder: number) => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('settings.permissionPhotos'), t('settings.permissionPhotosWhy'));
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (picked.canceled || !picked.assets[0]) return;

    setUploading(true);
    try {
      const asset = picked.assets[0];
      await uploadProductImage(productId, {
        uri: asset.uri,
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        ...(asset.fileSize ? { fileSize: asset.fileSize } : {}),
      }, sortOrder);
      void queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) return <><Header /><LoadingState /></>;
  if (loadError) return <><Header /><ErrorState messageKey={errorKey(loadError)} onRetry={() => void refetch()} /></>;

  return (
    <View style={styles.container}>
      <Header
        title={t('nav.products')}
        right={
          <Pressable onPress={openNew} hitSlop={10}>
            <Ionicons name="add-circle" size={26} color={theme.color.primary} />
          </Pressable>
        }
      />

      <FlatList
        data={data?.products ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="pricetags-outline"
            title={t('empty.products')}
            action={<Button label={t('sell.newProduct')} onPress={openNew} full={false} />}
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.row}>
            {item.images[0] ? (
              <Image source={{ uri: item.images[0].url }} style={styles.thumb} contentFit="cover" />
            ) : (
              <Pressable
                onPress={() => void addPhoto(item.id, 0)}
                style={[styles.thumb, styles.thumbEmpty]}
                disabled={uploading}
              >
                <Ionicons name="camera-outline" size={20} color={theme.color.primary} />
                <Text style={styles.addPhotoText}>{t('sell.addPhoto')}</Text>
              </Pressable>
            )}

            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowPrice}>{formatMoney(item.priceMinor, locale)}</Text>
              <Text style={styles.rowMeta}>
                {t(`sell.status.${item.status}`)} · {t('product.quantityLeft', { count: item.quantity })}
              </Text>
            </View>

            <View style={styles.rowActions}>
              <Pressable onPress={() => openEdit(item)} hitSlop={8}>
                <Ionicons name="create-outline" size={20} color={theme.color.primary} />
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  Alert.alert(t('common.delete'), t('sell.deleteConfirm'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate(item.id) },
                  ])
                }
              >
                <Ionicons name="trash-outline" size={20} color={theme.color.danger} />
              </Pressable>
            </View>
          </Card>
        )}
      />

      <Modal visible={showEditor} transparent animationType="slide" onRequestClose={() => setShowEditor(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowEditor(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>
                {editing ? t('sell.editProduct') : t('sell.newProduct')}
              </Text>

              <Field label={t('sell.title')} required value={title} onChangeText={setTitle} />
              <Field
                label={t('sell.description')}
                value={description}
                onChangeText={setDescription}
                multiline
                style={styles.textarea}
              />
              <Field
                label={t('sell.price')}
                required
                hint={t('sell.priceHint')}
                value={price}
                onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
              />
              <Field
                label={t('sell.quantity')}
                required
                value={quantity}
                onChangeText={(v) => setQuantity(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
              />

              {editing ? (
                <View>
                  <Text style={styles.photosLabel}>{t('sell.photos')}</Text>
                  <Text style={styles.photosHint}>{t('sell.photoHint')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                    {editing.images.map((img) => (
                      <Image key={img.id} source={{ uri: img.url }} style={styles.photo} contentFit="cover" />
                    ))}
                    <Pressable
                      onPress={() => void addPhoto(editing.id, editing.images.length)}
                      style={[styles.photo, styles.photoAdd]}
                      disabled={uploading}
                    >
                      <Ionicons name="add" size={24} color={theme.color.primary} />
                    </Pressable>
                  </ScrollView>
                </View>
              ) : (
                <Text style={styles.photosHint}>{t('sell.photoHint')}</Text>
              )}

              {error ? <Text style={styles.error}>{t(error)}</Text> : null}

              <Button
                label={t('sell.publish')}
                onPress={() => save.mutate()}
                loading={save.isPending}
                disabled={!title.trim() || !price || Number(price) <= 0}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.background },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceMuted },
  thumbEmpty: {
    alignItems: 'center', justifyContent: 'center', gap: 2,
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.primary,
  },
  addPhotoText: { fontSize: 9, color: theme.color.primary, textAlign: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  rowPrice: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.color.primary },
  rowMeta: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  rowActions: { gap: theme.spacing.lg },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.surface, maxHeight: '90%',
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
  },
  sheetBody: { padding: theme.spacing.xl, gap: theme.spacing.lg },
  sheetTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.color.text },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  photosLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  photosHint: { fontSize: theme.fontSize.xs, color: theme.color.textMuted, marginTop: 4 },
  photoStrip: { gap: theme.spacing.sm, paddingTop: theme.spacing.md },
  photo: { width: 80, height: 80, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceMuted },
  photoAdd: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.primary,
  },
  error: { color: theme.color.danger, fontSize: theme.fontSize.sm },
});
