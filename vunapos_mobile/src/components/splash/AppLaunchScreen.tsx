import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { BrandMark } from "@/components/brand/BrandMark";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type AppLaunchScreenProps = {
  message: string;
  onReady?: () => void;
};

/**
 * Mirrors the native splash background, then keeps the transition alive while
 * fonts and encrypted configuration are loaded.
 */
export function AppLaunchScreen({ message, onReady }: AppLaunchScreenProps) {
  const { palette } = useAppearance();
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
    <View
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      onLayout={onReady}
      style={[styles.screen, { backgroundColor: palette.background }]}
    >
      <View
        style={[
          styles.markPanel,
          {
            backgroundColor: palette.surface,
            borderColor: palette.borderSubtle,
          },
        ]}
      >
        <BrandMark />
      </View>
      <Text style={[styles.name, { color: palette.onSurface }]}>VunaPOS</Text>
      <Text style={[styles.subtitle, { color: palette.onSurfaceMuted }]}>
        Mobile point of sale
      </Text>
      <View
        style={[
          styles.progressTrack,
          { backgroundColor: palette.borderSubtle },
        ]}
      >
        <Animated.View
          style={[
            styles.progressIndicator,
            {
              backgroundColor: palette.primary,
              transform: [{ translateX: progress }],
            },
          ]}
        />
      </View>
      <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  markPanel: {
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    height: 112,
    justifyContent: "center",
    width: 112,
  },
  name: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 22,
    letterSpacing: 0.4,
    marginTop: spacing.lg,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    marginTop: spacing.xs / 2,
  },
  progressTrack: {
    borderRadius: radii.pill,
    height: 3,
    marginTop: spacing.xxl,
    overflow: "hidden",
    width: 144,
  },
  progressIndicator: {
    borderRadius: radii.pill,
    height: 3,
    width: 72,
  },
  message: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
