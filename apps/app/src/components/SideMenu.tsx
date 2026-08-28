/**
 * The side menu, opened by tapping the circular logo in the header.
 *
 * On RTL it slides in from the right, because that is where "leading" is in
 * Arabic — the drawer must follow reading direction, not a hard-coded side.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@siab/core';

import { useLocaleInfo, useT } from '../hooks/useT';
import { useSession } from '../lib/session';
import { Logo } from './Logo';
import { ScoreBadge } from './ScoreBadge';

interface MenuItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  roles?: ('buyer' | 'seller')[];
}

const ITEMS: MenuItem[] = [
  { key: 'nav.market', icon: 'storefront-outline', route: '/(tabs)/market' },
  { key: 'nav.saved', icon: 'bookmark-outline', route: '/(tabs)/saved', roles: ['buyer'] },
  { key: 'nav.orders', icon: 'receipt-outline', route: '/(tabs)/orders' },
  { key: 'nav.messages', icon: 'chatbubbles-outline', route: '/(tabs)/messages' },
  { key: 'nav.products', icon: 'pricetags-outline', route: '/seller/products', roles: ['seller'] },
  { key: 'nav.insights', icon: 'stats-chart-outline', route: '/seller/insights', roles: ['seller'] },
  { key: 'nav.assistant', icon: 'sparkles-outline', route: '/seller/assistant', roles: ['seller'] },
  { key: 'nav.coworker', icon: 'briefcase-outline', route: '/seller/coworker', roles: ['seller'] },
  { key: 'nav.notifications', icon: 'notifications-outline', route: '/notifications' },
  { key: 'nav.settings', icon: 'settings-outline', route: '/settings' },
];

interface SideMenuProps {
  visible: boolean;
  onClose: () => void;
  displayName?: string;
  score?: number;
}

export function SideMenu({ visible, onClose, displayName, score }: SideMenuProps) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRtl } = useLocaleInfo();
  const { width } = useWindowDimensions();
  const { role } = useSession();

  const panelWidth = Math.min(320, width * 0.82);
  const items = ITEMS.filter((i) => !i.roles || (role && i.roles.includes(role)));

  const go = (route: string) => {
    onClose();
    // Let the modal finish dismissing before navigating, or the transition
    // stutters on native.
    setTimeout(() => router.push(route as never), 120);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.panel,
            { width: panelWidth, paddingTop: insets.top + theme.spacing.lg },
            isRtl ? styles.panelRight : styles.panelLeft,
          ]}
        >
          <View style={styles.header}>
            <Logo size={52} />
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName ?? t('common.appName')}
              </Text>
              {score !== undefined ? <ScoreBadge score={score} size="sm" /> : null}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.list}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => go(item.route)}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                accessibilityRole="link"
              >
                <Ionicons name={item.icon} size={22} color={theme.color.primary} />
                <Text style={styles.itemLabel}>{t(item.key)}</Text>
                <Ionicons
                  name={isRtl ? 'chevron-back' : 'chevron-forward'}
                  size={18}
                  color={theme.color.textMuted}
                />
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.spacing.lg,
  },
  panelLeft: { left: 0, borderTopRightRadius: theme.radius.xl, borderBottomRightRadius: theme.radius.xl },
  panelRight: { right: 0, borderTopLeftRadius: theme.radius.xl, borderBottomLeftRadius: theme.radius.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerText: { flex: 1, gap: 4 },
  name: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },

  list: { paddingVertical: theme.spacing.md, gap: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  itemPressed: { backgroundColor: theme.color.primarySubtle },
  itemLabel: { flex: 1, fontSize: theme.fontSize.md, color: theme.color.text, fontWeight: '500' },
});
