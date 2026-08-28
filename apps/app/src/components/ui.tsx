/**
 * The shared building blocks. White and cyan throughout.
 *
 * Every screen composes from these, so spacing, radius and colour stay
 * consistent and no component invents its own hex value.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { theme } from '@siab/core';

import { useT } from '../hooks/useT';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  full?: boolean;
  style?: ViewStyle;
}

export function Button({
  label, onPress, variant = 'primary', disabled, loading, icon, full = true, style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const bg = variant === 'primary' ? theme.color.primary
    : variant === 'danger' ? theme.color.danger
    : variant === 'secondary' ? theme.color.primarySubtle
    : 'transparent';

  const fg = variant === 'primary' || variant === 'danger' ? theme.color.onPrimary
    : theme.color.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        variant === 'ghost' && styles.buttonGhost,
        full && styles.buttonFull,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

export function Field({ label, hint, error, required, style, ...rest }: FieldProps) {
  const t = useT();
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {!required ? <Text style={styles.fieldOptional}>{t('common.optional')}</Text> : null}
      </View>
      <TextInput
        {...rest}
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={theme.color.textMuted}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// State views — every screen needs all four (§42)
// ---------------------------------------------------------------------------

export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <View style={styles.state}>
      <ActivityIndicator size="large" color={theme.color.primary} />
      <Text style={styles.stateText}>{label ?? t('common.loading')}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline', title, action,
}: { icon?: keyof typeof Ionicons.glyphMap; title: string; action?: ReactNode }) {
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={30} color={theme.color.primary} />
      </View>
      <Text style={styles.stateText}>{title}</Text>
      {action}
    </View>
  );
}

export function ErrorState({ messageKey, params, onRetry }: {
  messageKey: string;
  params?: Record<string, unknown>;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, styles.stateIconError]}>
        <Ionicons name="alert-circle-outline" size={30} color={theme.color.danger} />
      </View>
      <Text style={styles.stateText}>{t(messageKey, params)}</Text>
      {onRetry ? <Button label={t('common.retry')} onPress={onRetry} variant="secondary" full={false} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Badge({ label, color = theme.color.primary }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A`, borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  button: {
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonFull: { alignSelf: 'stretch' },
  buttonGhost: { borderWidth: 1, borderColor: theme.color.border },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.45 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  buttonLabel: { fontSize: theme.fontSize.md, fontWeight: '600' },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.spacing.lg,
  },
  cardPressed: { opacity: 0.9, borderColor: theme.color.primary },

  field: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.color.text },
  fieldOptional: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
    fontSize: theme.fontSize.md,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  },
  inputError: { borderColor: theme.color.danger },
  fieldHint: { fontSize: theme.fontSize.xs, color: theme.color.textMuted },
  fieldError: { fontSize: theme.fontSize.xs, color: theme.color.danger },

  state: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl, gap: theme.spacing.lg },
  stateIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: theme.color.primarySubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  stateIconError: { backgroundColor: '#FEE2E2' },
  stateText: { fontSize: theme.fontSize.md, color: theme.color.textMuted, textAlign: 'center' },

  badge: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: theme.fontSize.xs, fontWeight: '600' },

  sectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  sectionTitle: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.color.text },

  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.spacing.lg },
});
