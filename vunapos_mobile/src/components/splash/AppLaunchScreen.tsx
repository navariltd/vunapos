import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";

import { spacing, typography } from "@/theme/tokens";

type AppLaunchScreenProps = {
  message: string;
  onReady?: () => void;
};

/** A branded continuation of the native splash while the first route becomes ready. */
export function AppLaunchScreen({ message, onReady }: AppLaunchScreenProps) {
  const [progress] = useState(() => new Animated.Value(-64));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 160,
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
      style={styles.screen}
    >
      <StatusBar style="dark" />
      <Image
        accessibilityLabel="VunaPOS logo"
        source={require("../../../assets/images/vuna-logo.png")}
        style={styles.logo}
      />
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressIndicator, { transform: [{ translateX: progress }] }]} />
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  logo: {
    height: 128,
    position: "absolute",
    top: "50%",
    transform: [{ translateY: -64 }],
    width: 128,
  },
  progressTrack: {
    backgroundColor: "#dce2e8",
    borderRadius: 999,
    height: 3,
    marginTop: 180,
    overflow: "hidden",
    width: 160,
  },
  progressIndicator: {
    backgroundColor: "#08a9e8",
    height: 3,
    width: 64,
  },
  message: {
    alignSelf: "stretch",
    color: "#415066",
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
