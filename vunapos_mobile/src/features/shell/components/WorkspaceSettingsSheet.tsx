import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, Modal, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppearancePreference } from "@/services/appearanceStore";
import { PosOrderType } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type WorkspaceSettingsSheetProps = {
  onClose: () => void;
  onOrderTypeChange: (orderType: PosOrderType) => void;
  orderType: PosOrderType;
  visible: boolean;
};

const appearanceOptions: {
  icon: "brightness-6" | "weather-night" | "white-balance-sunny";
  label: string;
  value: AppearancePreference;
}[] = [
  { icon: "brightness-6", label: "System", value: "system" },
  { icon: "white-balance-sunny", label: "Light", value: "light" },
  { icon: "weather-night", label: "Dark", value: "dark" },
];

/** One expandable home for workspace preferences without crowding the POS header. */
export function WorkspaceSettingsSheet({
  onClose,
  onOrderTypeChange,
  orderType,
  visible,
}: WorkspaceSettingsSheetProps) {
  const { palette, preference, setPreference } = useAppearance();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={[styles.scrim, { backgroundColor: palette.scrim }]}>
        <Pressable
          accessibilityLabel="Close workspace menu"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
              <MaterialCommunityIcons
                color={palette.onPrimary}
                name="account-outline"
                size={22}
              />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: palette.onSurface }]}>
                Workspace
              </Text>
              <Text
                style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
              >
                Sale and appearance preferences
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close workspace menu"
              onPress={onClose}
              style={[styles.close, { borderColor: palette.border }]}
            >
              <MaterialCommunityIcons
                color={palette.onSurface}
                name="close"
                size={20}
              />
            </Pressable>
          </View>

          <Text
            style={[styles.sectionLabel, { color: palette.onSurfaceMuted }]}
          >
            SALE MODE
          </Text>
          <View style={styles.optionRow}>
            {(["Invoice", "Order"] as PosOrderType[]).map((option) => {
              const selected = option === orderType;
              return (
                <Pressable
                  accessibilityLabel={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={option}
                  onPress={() => onOrderTypeChange(option)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected
                        ? palette.primary
                        : palette.surfaceContainer,
                      borderColor: selected ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color: selected ? palette.onPrimary : palette.onSurface,
                      },
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            style={[styles.sectionLabel, { color: palette.onSurfaceMuted }]}
          >
            APPEARANCE
          </Text>
          <View style={styles.optionRow}>
            {appearanceOptions.map((option) => {
              const selected = option.value === preference;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={option.value}
                  onPress={() => void setPreference(option.value)}
                  style={[
                    styles.appearanceOption,
                    {
                      backgroundColor: selected
                        ? palette.primary
                        : palette.surfaceContainer,
                      borderColor: selected ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    color={selected ? palette.onPrimary : palette.onSurface}
                    name={option.icon}
                    size={18}
                  />
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color: selected ? palette.onPrimary : palette.onSurface,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  appearanceOption: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 58,
    padding: spacing.xs,
  },
  avatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  close: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  handle: {
    alignSelf: "center",
    borderRadius: radii.pill,
    height: 4,
    marginBottom: spacing.md,
    width: 42,
  },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  headerCopy: { flex: 1 },
  option: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  optionLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  optionRow: { flexDirection: "row", gap: spacing.sm },
  scrim: { flex: 1, justifyContent: "flex-end" },
  sectionLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
  },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
