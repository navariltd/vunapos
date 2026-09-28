import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, typography } from "@/theme/tokens";

type PosCartButtonProps = {
  itemCount: number;
  onPress: () => void;
};

export function PosCartButton({ itemCount, onPress }: PosCartButtonProps) {
  const { palette } = useAppearance();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={`Cart, ${itemCount} items`}
        onPress={onPress}
        style={[styles.button, { backgroundColor: palette.primary }]}
      >
        <MaterialCommunityIcons
          color={palette.onPrimary}
          name="cart-outline"
          size={26}
        />
      </Pressable>
      {itemCount > 0 ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          testID="cart-item-count"
          style={[
            styles.badge,
            {
              backgroundColor: palette.notification,
              color: palette.onNotification,
            },
          ]}
        >
          {itemCount}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    height: 20,
    lineHeight: 20,
    minWidth: 20,
    paddingHorizontal: 5,
    position: "absolute",
    right: -2,
    textAlign: "center",
    top: -4,
  },
  button: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  container: {
    bottom: 16,
    position: "absolute",
    right: 16,
  },
});
