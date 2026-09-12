import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosItemSearchProps = {
  onChangeText: (value: string) => void;
  onScanBarcode: () => void;
  onSubmit: () => void;
  value: string;
};

export function PosItemSearch({
  onChangeText,
  onScanBarcode,
  onSubmit,
  value,
}: PosItemSearchProps) {
  const { palette } = useAppearance();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <MaterialCommunityIcons
          color={palette.onSurfaceMuted}
          name="magnify"
          size={20}
        />
        <TextInput
          accessibilityLabel="Search items"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder="Search by item name, code, or barcode"
          placeholderTextColor={palette.onSurfaceMuted}
          returnKeyType="search"
          style={[styles.input, { color: palette.onSurface }]}
          value={value}
        />
      </View>
      <Pressable
        accessibilityLabel="Scan barcode with camera"
        onPress={onScanBarcode}
        style={[
          styles.cameraButton,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <MaterialCommunityIcons
          color={palette.onSurface}
          name="camera-outline"
          size={20}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  container: {
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: "100%",
    paddingVertical: 0,
  },
  inputContainer: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
});
