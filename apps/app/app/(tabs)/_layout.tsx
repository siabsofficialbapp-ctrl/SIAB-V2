/**
 * Bottom tabs.
 *
 * Icons are ALWAYS visible — selected or not. The default behaviour of
 * hiding or dimming an icon on press made tabs look like they disappeared,
 * so both the icon and its label are rendered in every state; only the
 * colour changes.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { theme } from '@siab/core';

import { useT } from '../../src/hooks/useT';
import { useSession } from '../../src/lib/session';

interface TabIconProps {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
}

function TabIcon({ name, label, focused }: TabIconProps) {
  const color = focused ? theme.color.primary : theme.color.textMuted;
  return (
    <View style={styles.tabItem}>
      {/* Rendered unconditionally: the icon never vanishes on selection. */}
      <Ionicons name={name} size={22} color={color} />
      <Text numberOfLines={1} style={[styles.tabLabel, { color, fontWeight: focused ? '700' : '500' }]}>
        {label}
      </Text>
      <View style={[styles.indicator, focused && styles.indicatorActive]} />
    </View>
  );
}

export default function TabsLayout() {
  const t = useT();
  const { role } = useSession();
  const isSeller = role === 'seller';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false, // our TabIcon draws the label itself
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      <Tabs.Screen
        name="market"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="storefront-outline" label={t('nav.market')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="search-outline" label={t('nav.search')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          // A seller has no "saved" list; hide the route rather than showing
          // a tab that leads nowhere useful.
          href: isSeller ? null : '/(tabs)/saved',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bookmark-outline" label={t('nav.saved')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="chatbubbles-outline" label={t('nav.messages')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="receipt-outline" label={t('nav.orders')} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: Platform.OS === 'ios' ? 88 : 66,
    paddingTop: 8,
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  tabBarItem: { paddingVertical: 0 },
  tabItem: { alignItems: 'center', justifyContent: 'flex-start', gap: 3, width: 72 },
  tabLabel: { fontSize: 11 },
  indicator: { height: 2, width: 18, borderRadius: 1, backgroundColor: 'transparent' },
  indicatorActive: { backgroundColor: theme.color.primary },
});
