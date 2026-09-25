import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, Modal, StyleSheet, View } from "react-native";
import { useState } from "react";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppearancePreference } from "@/services/appearanceStore";
import { PosOrderType } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type WorkspaceSettingsSheetProps = {
  onClose: () => void;
  onClearLocalData: () => Promise<void>;
  onOrderTypeChange: (orderType: PosOrderType) => void;
  onSignOut?: () => Promise<void>;
  orderType: PosOrderType;
  allowOrderTypeChange?: boolean;
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
  onClearLocalData,
  onOrderTypeChange,
  onSignOut,
  orderType,
  allowOrderTypeChange = true,
  visible,
}: WorkspaceSettingsSheetProps) {
  const { palette, preference, setPreference } = useAppearance();
  const insets = useSafeAreaInsets();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function confirmClearLocalData() {
    setIsClearing(true);
    try {
      await onClearLocalData();
      setConfirmingClear(false);
      onClose();
    } finally {
      setIsClearing(false);
    }
  }

  async function confirmSignOut() {
    if (!onSignOut) return;
    setIsSigningOut(true);
    try {
      await onSignOut();
      setConfirmingSignOut(false);
      onClose();
    } finally {
      setIsSigningOut(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={[styles.scrim, { backgroundColor: palette.scrim }]}>
        <Pressable
          accessibilityLabel="Close workspace menu"
          onPress={isClearing ? undefined : onClose}
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
              disabled={isClearing}
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

          {onSignOut ? (
            <>
              <Text
                style={[styles.sectionLabel, { color: palette.onSurfaceMuted }]}
              >
                ACCOUNT
              </Text>
              {confirmingSignOut ? (
                <View
                  style={[
                    styles.clearConfirmation,
                    {
                      backgroundColor: palette.errorSurface,
                      borderColor: palette.error,
                    },
                  ]}
                >
                  <Text style={[styles.confirmationTitle, { color: palette.onError }]}>Sign out?</Text>
                  <Text style={[styles.confirmationCopy, { color: palette.onError }]}>Your saved workspace data will be cleared from this device.</Text>
                  <View style={styles.confirmationActions}>
                    <Pressable
                      accessibilityLabel="Cancel signing out"
                      disabled={isSigningOut}
                      onPress={() => setConfirmingSignOut(false)}
                      style={[styles.clearAction, { borderColor: palette.error }]}
                    >
                      <Text style={[styles.clearActionLabel, { color: palette.onError }]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Confirm signing out"
                      disabled={isSigningOut}
                      onPress={() => void confirmSignOut()}
                      style={[styles.clearAction, { backgroundColor: palette.error }]}
                    >
                      <Text style={[styles.clearActionLabel, { color: palette.onPrimary }]}>{isSigningOut ? "Signing out…" : "Sign out"}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityLabel="Sign out"
                  onPress={() => setConfirmingSignOut(true)}
                  style={[styles.clearDataButton, { borderColor: palette.error }]}
                >
                  <MaterialCommunityIcons color={palette.error} name="logout" size={18} />
                  <Text style={[styles.clearDataLabel, { color: palette.error }]}>Sign out</Text>
                </Pressable>
              )}
            </>
          ) : null}

          <Text
            style={[styles.sectionLabel, { color: palette.onSurfaceMuted }]}
          >
            SALE MODE
          </Text>
          <View style={styles.optionRow}>
            {(allowOrderTypeChange
              ? (["Invoice", "Order"] as PosOrderType[])
              : [orderType]
            ).map((option) => {
              const selected = option === orderType;
              return (
                <Pressable
                  accessibilityLabel={option}
                  accessibilityRole="radio"
                  accessibilityState={
                    allowOrderTypeChange
                      ? { selected }
                      : { disabled: true, selected }
                  }
                  disabled={allowOrderTypeChange ? undefined : true}
                  key={option}
                  onPress={
                    allowOrderTypeChange
                      ? () => onOrderTypeChange(option)
                      : undefined
                  }
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

          <Text
            style={[styles.sectionLabel, { color: palette.onSurfaceMuted }]}
          >
            LOCAL DATA
          </Text>
          <Text
            style={[styles.localDataCopy, { color: palette.onSurfaceMuted }]}
          >
            Clears saved catalogue, invoices, payments, and customers from this
            device. Your company URL and sign-in remain.
          </Text>
          {confirmingClear ? (
            <View
              style={[
                styles.clearConfirmation,
                {
                  backgroundColor: palette.errorSurface,
                  borderColor: palette.error,
                },
              ]}
            >
              <Text
                style={[styles.confirmationTitle, { color: palette.onError }]}
              >
                Clear saved POS data?
              </Text>
              <Text
                style={[styles.confirmationCopy, { color: palette.onError }]}
              >
                The POS will reload data from your workspace. This does not sign
                you out.
              </Text>
              <View style={styles.confirmationActions}>
                <Pressable
                  accessibilityLabel="Cancel clearing saved POS data"
                  disabled={isClearing}
                  onPress={() => setConfirmingClear(false)}
                  style={[styles.clearAction, { borderColor: palette.error }]}
                >
                  <Text
                    style={[
                      styles.clearActionLabel,
                      { color: palette.onError },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Confirm clearing saved POS data"
                  disabled={isClearing}
                  onPress={() => void confirmClearLocalData()}
                  style={[
                    styles.clearAction,
                    { backgroundColor: palette.error },
                  ]}
                >
                  <Text
                    style={[
                      styles.clearActionLabel,
                      { color: palette.onPrimary },
                    ]}
                  >
                    {isClearing ? "Clearing…" : "Clear data"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityLabel="Clear saved POS data"
              onPress={() => setConfirmingClear(true)}
              style={[styles.clearDataButton, { borderColor: palette.error }]}
            >
              <MaterialCommunityIcons
                color={palette.error}
                name="database-remove-outline"
                size={18}
              />
              <Text style={[styles.clearDataLabel, { color: palette.error }]}>
                Clear saved POS data
              </Text>
            </Pressable>
          )}
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
  clearAction: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  clearActionLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  clearConfirmation: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  clearDataButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  clearDataLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  confirmationActions: { flexDirection: "row", gap: spacing.sm },
  confirmationCopy: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  confirmationTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
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
  localDataCopy: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
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
