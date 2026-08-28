/**
 * The SIAB score, shown beside a member's name.
 *
 * The number and its colour are the whole rating system — there are no stars
 * anywhere in SIAB.
 */
import { StyleSheet, Text, View } from 'react-native';

import { SCORE_BAND_COLOR, scoreBand, theme, type ScoreBand } from '@siab/core';

import { useT } from '../hooks/useT';

interface ScoreBadgeProps {
  score: number;
  band?: ScoreBand;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function ScoreBadge({ score, band, size = 'md', showLabel = false }: ScoreBadgeProps) {
  const t = useT();
  const resolved = band ?? scoreBand(score);
  const color = SCORE_BAND_COLOR[resolved];

  const dims = size === 'sm'
    ? { padH: 8, padV: 2, font: theme.fontSize.xs, dot: 6 }
    : size === 'lg'
      ? { padH: 14, padV: 6, font: theme.fontSize.lg, dot: 10 }
      : { padH: 10, padV: 4, font: theme.fontSize.sm, dot: 8 };

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: `${color}1A`, // 10% tint of the band colour
            borderColor: color,
            paddingHorizontal: dims.padH,
            paddingVertical: dims.padV,
          },
        ]}
        accessibilityLabel={`${t('score.label')}: ${score}, ${t(`score.band.${resolved}`)}`}
      >
        <View style={[styles.dot, { backgroundColor: color, width: dims.dot, height: dims.dot, borderRadius: dims.dot / 2 }]} />
        <Text style={[styles.score, { color, fontSize: dims.font }]}>{score}</Text>
      </View>
      {showLabel ? (
        <Text style={[styles.label, { color }]}>{t(`score.band.${resolved}`)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
  },
  dot: {},
  score: { fontWeight: '700' },
  label: { fontSize: theme.fontSize.xs, fontWeight: '600' },
});
