import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";

import { PosProductBundle } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type Props = {
  bundle: PosProductBundle | null;
  error: string | null;
  isAdding: boolean;
  isLoading: boolean;
  itemName?: string;
  onConfirm: () => void;
  onDismiss: () => void;
  visible: boolean;
};

/** Requires cashier confirmation after showing server-authoritative bundle contents. */
export function PosProductBundleSheet({
  bundle,
  error,
  isAdding,
  isLoading,
  itemName,
  onConfirm,
  onDismiss,
  visible,
}: Props) {
  const { palette } = useAppearance();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Dismiss bundle review"
          onPress={onDismiss}
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: palette.onSurface }]}>
                Review bundle
              </Text>
              <Text
                style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
              >
                {itemName}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close bundle review"
              onPress={onDismiss}
            >
              <Text style={[styles.close, { color: palette.onSurface }]}>
                Close
              </Text>
            </Pressable>
          </View>
          {isLoading ? (
            <View style={styles.state}>
              <ActivityIndicator color={palette.primary} />
              <Text
                style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
              >
                Loading bundle components…
              </Text>
            </View>
          ) : error ? (
            <Text style={[styles.error, { color: palette.error }]}>
              {error}
            </Text>
          ) : (
            <ScrollView style={styles.list}>
              {bundle?.items.map((item) => (
                <View
                  key={item.item_code}
                  style={[styles.row, { borderColor: palette.border }]}
                >
                  <View style={styles.rowMain}>
                    <Text style={[styles.name, { color: palette.onSurface }]}>
                      {item.item_name || item.item_code}
                    </Text>
                    <Text
                      style={[
                        styles.subtitle,
                        { color: palette.onSurfaceMuted },
                      ]}
                    >
                      {item.item_code} · {item.qty} {item.uom || "units"}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.subtitle,
                      {
                        color:
                          item.available_qty !== undefined &&
                          item.available_qty !== null &&
                          item.available_qty < (item.qty || 0)
                            ? palette.error
                            : palette.onSurfaceMuted,
                      },
                    ]}
                  >
                    {item.available_qty === undefined ||
                    item.available_qty === null
                      ? ""
                      : `${item.available_qty} available`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable
            accessibilityLabel="Confirm add bundle"
            disabled={!bundle || isLoading || Boolean(error) || isAdding}
            onPress={onConfirm}
            style={[
              styles.confirm,
              {
                backgroundColor:
                  !bundle || isLoading || Boolean(error) || isAdding
                    ? palette.disabled
                    : palette.primary,
              },
            ]}
          >
            {isAdding ? (
              <ActivityIndicator color={palette.onPrimary} />
            ) : (
              <Text style={[styles.confirmLabel, { color: palette.onPrimary }]}>
                Add bundle
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  close: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  confirm: {
    alignItems: "center",
    borderRadius: radii.md,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  confirmLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  error: {
    fontFamily: typography.fontFamily.medium,
    paddingVertical: spacing.xl,
    textAlign: "center",
  },
  handle: {
    alignSelf: "center",
    borderRadius: radii.pill,
    height: 4,
    marginBottom: spacing.md,
    width: 40,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  list: { marginTop: spacing.md },
  name: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  root: { flex: 1, justifyContent: "flex-end" },
  row: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowMain: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "82%",
    minHeight: "42%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  state: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
