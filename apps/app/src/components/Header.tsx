/**
 * The app header: circular logo top-left (top-right in Arabic), which opens
 * the side menu.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@siab/core';

import { useT } from '../hooks/useT';
import { Logo } from './Logo';
import { SideMenu } from './SideMenu';

interface HeaderProps {
  title?: string;
  displayName?: string;
  score?: number;
  right?: React.ReactNode;
}

export function Header({ title, displayName, score, right }: HeaderProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Logo size={38} onPress={() => setMenuOpen(true)} accessibilityLabel={t('nav.settings')} />
        <Text style={styles.title} numberOfLines={1}>
          {title ?? t('common.appName')}
        </Text>
        <View style={styles.right}>
          {right ?? (
            <Pressable
              onPress={() => router.push('/notifications' as never)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('nav.notifications')}
            >
              <Ionicons name="notifications-outline" size={24} color={theme.color.text} />
            </Pressable>
          )}
        </View>
      </View>

      <SideMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        {...(displayName ? { displayName } : {})}
        {...(score !== undefined ? { score } : {})}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  title: { flex: 1, fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },
  right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
});
