/**
 * The SIAB logo, always circular.
 *
 * Used in the header (top-left, tappable — it opens the side menu) and
 * anywhere else the mark appears. The source artwork is square with a dark
 * background, so it is centred inside a circular container painted the same
 * dark colour: the crop then reads as deliberate rather than clipped.
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

/** Matches the artwork's own background so the circle blends into the mark. */
export const LOGO_BACKGROUND = '#0B1220';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_SOURCE = require('../../assets/logo.png');

interface LogoProps {
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Logo({ size = 36, onPress, accessibilityLabel, style }: LogoProps) {
  const circle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: LOGO_BACKGROUND,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const content = (
    <View style={[circle, style]}>
      <Image
        source={LOGO_SOURCE}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Open menu'}
      // A comfortable tap target even when the mark itself is small.
      hitSlop={10}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
