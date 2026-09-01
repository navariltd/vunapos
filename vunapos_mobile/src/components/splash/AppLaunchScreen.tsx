import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { BrandMark } from '@/components/brand/BrandMark';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type AppLaunchScreenProps = {
  message: string;
  onReady?: () => void;
};

/**
 * Mirrors the native splash background, then keeps the transition alive while
 * fonts and encrypted configuration are loaded.
 */
export function AppLaunchScreen({ message, onReady }: AppLaunchScreenProps) {
  const [progress] = useState(() => new Animated.Value(-72));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 72,
        duration: 1200,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <View accessibilityLabel={message} accessibilityRole="progressbar" onLayout={onReady} style={styles.screen}>
      <View style={styles.markPanel}>
        <BrandMark />
      </View>
      <Text style={styles.name}>VunaPOS</Text>
      <Text style={styles.subtitle}>Mobile point of sale</Text>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressIndicator, { transform: [{ translateX: progress }] }]} />
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: colors.surface.canvas,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  markPanel: {
    alignItems: 'center',
    backgroundColor: colors.surface.base,
    borderColor: colors.border.subtle,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  name: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 22,
    letterSpacing: 0.4,
    marginTop: spacing.lg,
  },
  subtitle: {
    color: colors.ink.secondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    marginTop: spacing.xs / 2,
  },
  progressTrack: {
    backgroundColor: colors.border.subtle,
    borderRadius: radii.pill,
    height: 3,
    marginTop: spacing.xxl,
    overflow: 'hidden',
    width: 144,
  },
  progressIndicator: {
    backgroundColor: colors.ink.primary,
    borderRadius: radii.pill,
    height: 3,
    width: 72,
  },
  message: {
    color: colors.ink.secondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
