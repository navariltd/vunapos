import { MaterialCommunityIcons } from "@expo/vector-icons";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { PropsWithChildren } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";
import { scheduleOnRN } from "react-native-worklets";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCartDrawerProps = PropsWithChildren<{
  onClose: () => void;
}>;

export type PosCartDrawerHandle = { close: () => void };

/** Keeps the catalogue mounted behind the quick-access cart, like the SPA. */
export const PosCartDrawer = forwardRef<PosCartDrawerHandle, PosCartDrawerProps>(function PosCartDrawer({ children, onClose }, ref) {
  const { palette } = useAppearance();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.88, 512);
  const closedOffset = drawerWidth;
  const translateX = useSharedValue(closedOffset);
  const backdropOpacity = useSharedValue(0);
  const isClosing = useRef(false);
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  function open() {
    if (isClosing.current) return;
    translateX.set(withTiming(0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    }));
    backdropOpacity.set(withTiming(1, { duration: 280 }));
  }

  function close() {
    if (isClosing.current) return;
    isClosing.current = true;
    translateX.set(withTiming(closedOffset, {
      duration: 220,
      easing: Easing.in(Easing.cubic),
    }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    }));
    backdropOpacity.set(withTiming(0, { duration: 220 }));
  }

  useImperativeHandle(ref, () => ({ close }));

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={close}
      onShow={open}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      testID="pos-cart-drawer-modal"
      transparent
      visible
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityLabel="Dismiss cart"
            onPress={close}
            style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          />
        </Animated.View>
        <Animated.View
          testID="pos-cart-drawer-panel"
          style={[
            styles.drawer,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              bottom: insets.bottom,
              top: insets.top,
              width: drawerWidth,
            },
            drawerStyle,
          ]}
        >
          <View accessibilityViewIsModal style={styles.panelBody}>
            <View style={[styles.header, { borderBottomColor: palette.border }]}>
              <View style={styles.heading}>
                <MaterialCommunityIcons color={palette.primary} name="cart-outline" size={20} />
                <Text style={[styles.title, { color: palette.onSurface }]}>Cart</Text>
              </View>
              <Pressable
                accessibilityLabel="Close cart"
                accessibilityRole="button"
                onPress={close}
                style={styles.closeButton}
              >
                <MaterialCommunityIcons color={palette.onSurfaceMuted} name="close" size={24} />
              </Pressable>
            </View>
            <View style={styles.content}>{children}</View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  closeButton: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  content: { flex: 1, minHeight: 0 },
  drawer: {
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
    right: 0,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  heading: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  root: { flex: 1 },
  panelBody: { flex: 1 },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
});
