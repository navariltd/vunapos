import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge } from "react-native-paper";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii } from "@/theme/tokens";

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
        <Badge
          style={[
            styles.badge,
            { backgroundColor: palette.error, color: palette.onError },
          ]}
        >
          {itemCount}
        </Badge>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: -2,
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
