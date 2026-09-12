import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { PosTemplateVariant } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type Props = {
  currency: string;
  currencyPrecision?: number;
  error: string | null;
  isLoading: boolean;
  isSelecting?: boolean;
  onDismiss: () => void;
  onRetry: () => void;
  onSelect: (variant: PosTemplateVariant) => void;
  templateName?: string;
  variants: PosTemplateVariant[];
  visible: boolean;
};

function variantIsUnavailable(variant: PosTemplateVariant) {
  return (
    Boolean(variant.is_stock_item) &&
    !variant.allow_negative_stock &&
    Number(variant.actual_qty || 0) <= 0
  );
}

/** Native, searchable concrete-variant selection before an item reaches the cart. */
export function PosVariantPickerSheet({
  currency,
  currencyPrecision = 2,
  error,
  isLoading,
  isSelecting = false,
  onDismiss,
  onRetry,
  onSelect,
  templateName,
  variants,
  visible,
}: Props) {
  const { palette } = useAppearance();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const visibleVariants = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return variants;
    return variants.filter((variant) =>
      [
        variant.item_code,
        variant.item_name,
        ...(variant.attributes || []).flatMap(({ attribute, value }) => [
          attribute,
          value,
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, variants]);

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
          accessibilityLabel="Dismiss variant selector"
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
            <View style={styles.heading}>
              <Text style={[styles.title, { color: palette.onSurface }]}>
                Choose a variant
              </Text>
              <Text
                style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
              >
                {templateName || "Select the item variation to add."}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close variant selector"
              onPress={onDismiss}
              style={[styles.closeButton, { borderColor: palette.border }]}
            >
              <Text style={[styles.closeLabel, { color: palette.onSurface }]}>
                Close
              </Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="Search variants"
            onChangeText={setQuery}
            placeholder="Search variants or attributes"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[
              styles.search,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
                color: palette.onSurface,
              },
            ]}
            value={query}
          />
          {error ? (
            <View style={styles.errorState}>
              <Text style={[styles.errorText, { color: palette.error }]}>
                {error}
              </Text>
              <Pressable
                accessibilityLabel="Retry loading variants"
                onPress={onRetry}
                style={[styles.retryButton, { borderColor: palette.border }]}
              >
                <Text style={[styles.retryLabel, { color: palette.onSurface }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={palette.primary} />
              <Text
                style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
              >
                Loading variants…
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleVariants}
              keyExtractor={(variant) => variant.item_code}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>
                  No variants found.
                </Text>
              }
              renderItem={({ item: variant }) => {
                const unavailable = variantIsUnavailable(variant);
                return (
                  <View
                    style={[
                      styles.variant,
                      {
                        backgroundColor: palette.surfaceContainer,
                        borderColor: palette.border,
                        opacity: unavailable ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={styles.variantDetails}>
                      <Text
                        style={[
                          styles.variantName,
                          { color: palette.onSurface },
                        ]}
                      >
                        {variant.item_name || variant.item_code}
                      </Text>
                      <Text
                        style={[
                          styles.variantMeta,
                          { color: palette.onSurfaceMuted },
                        ]}
                      >
                        {variant.item_code}
                      </Text>
                      {variant.attributes?.length ? (
                        <Text
                          style={[
                            styles.variantMeta,
                            { color: palette.onSurfaceMuted },
                          ]}
                        >
                          {variant.attributes
                            .map(
                              ({ attribute, value }) =>
                                `${attribute}: ${value}`,
                            )
                            .join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.variantAction}>
                      <Text
                        style={[
                          styles.variantPrice,
                          { color: palette.onSurface },
                        ]}
                      >
                        {formatPosCurrency(
                          Number(variant.rate || 0),
                          currency,
                          currencyPrecision,
                        )}
                      </Text>
                      <Text
                        style={[
                          styles.variantMeta,
                          {
                            color: unavailable
                              ? palette.error
                              : palette.onSurfaceMuted,
                          },
                        ]}
                      >
                        {unavailable
                          ? "Out of stock"
                          : variant.is_stock_item
                            ? `${Number(variant.actual_qty || 0)} ${variant.stock_uom || "units"}`
                            : "Available"}
                      </Text>
                      <Pressable
                        accessibilityLabel={`Add variant ${variant.item_name || variant.item_code}`}
                        disabled={unavailable || isSelecting}
                        onPress={() => onSelect(variant)}
                        style={[
                          styles.addButton,
                          {
                            backgroundColor:
                              unavailable || isSelecting
                                ? palette.disabled
                                : palette.primary,
                          },
                        ]}
                      >
                        {isSelecting ? (
                          <ActivityIndicator
                            color={palette.onPrimary}
                            size="small"
                          />
                        ) : (
                          <Text
                            style={[
                              styles.addLabel,
                              { color: palette.onPrimary },
                            ]}
                          >
                            Add
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              }}
              showsVerticalScrollIndicator={false}
              style={styles.list}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  addButton: {
    borderRadius: radii.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  addLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  backdrop: { ...StyleSheet.absoluteFill },
  closeButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  closeLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  empty: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    padding: spacing.xl,
    textAlign: "center",
  },
  errorState: { alignItems: "center", gap: spacing.md, padding: spacing.xl },
  errorText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
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
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  heading: { flex: 1, gap: 2 },
  list: { marginTop: spacing.sm },
  loadingState: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  retryButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  root: { flex: 1, justifyContent: "flex-end" },
  search: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    marginTop: spacing.md,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "88%",
    minHeight: "58%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  variant: {
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  variantAction: { alignItems: "flex-end", minWidth: 88 },
  variantDetails: { flex: 1, gap: 2 },
  variantMeta: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  variantName: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  variantPrice: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
});
