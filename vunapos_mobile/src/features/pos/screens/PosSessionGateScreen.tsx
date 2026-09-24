import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  OpenPosShiftResult,
  useOpenPosShift,
} from "@/features/pos/hooks/useOpenPosShift";
import { PosPaymentMode, PosSession } from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosSessionGateScreenProps = {
  currency?: string;
  onShiftOpened?: (result: OpenPosShiftResult) => Promise<void> | void;
  paymentModes?: PosPaymentMode[];
  posProfile?: string;
  session: PosSession | null;
};

function openingAmount(value: string) {
  const normalized = value.trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * Prevents financial work until ERPNext has confirmed an open POS session.
 * When opening is required, the cashier can start their assigned POS profile
 * here with the backend-configured payment modes and balances.
 */
export function PosSessionGateScreen({
  currency,
  onShiftOpened,
  paymentModes = [],
  posProfile,
  session,
}: PosSessionGateScreenProps) {
  const { palette } = useAppearance();
  const toast = useToast();
  const { connectionStatus } = useNetworkStatus();
  const opening = useOpenPosShift();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => {
    if (validationError || opening.error) {
      const message = validationError || opening.error || "Unable to open POS shift.";
      toast.error(message, { title: "POS shift needs attention" });
    }
  }, [opening.error, toast, validationError]);

  if (!session) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
        <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
          Checking POS session…
        </Text>
      </View>
    );
  }

  const closingFailed = session.status === "CLOSING_FAILED";
  const closingInProgress = session.status === "CLOSING";
  const openingRequired = session.status === "OPENING_REQUIRED";
  const canOpen =
    openingRequired &&
    Boolean(posProfile) &&
    paymentModes.length > 0 &&
    connectionStatus === "online" &&
    !opening.isOpening;

  async function submitOpening() {
    if (!posProfile || !paymentModes.length || opening.isOpening) return;

    const openingBalances = paymentModes.map((mode) => {
      const amount = openingAmount(amounts[mode.mode_of_payment] || "");
      return { amount, mode_of_payment: mode.mode_of_payment };
    });
    const invalid = openingBalances.find(({ amount }) => amount === null);
    if (invalid) {
      setValidationError(
        `Enter a valid opening balance for ${invalid.mode_of_payment}.`,
      );
      return;
    }

    opening.clearError();
    setValidationError(null);
    const result = await opening.open({
      openingBalances: openingBalances.map(({ amount, mode_of_payment }) => ({
        mode_of_payment,
        opening_amount: amount ?? 0,
      })),
      posProfile,
    });
    if (result) await onShiftOpened?.(result);
  }

  if (!openingRequired) {
    const title = closingFailed
      ? "POS closing needs attention"
      : closingInProgress
        ? "POS closing in progress"
        : "POS session unavailable";
    const message = closingFailed
      ? `Closing entry ${session.closing_entry || ""} needs a supervisor review before sales can resume.`
      : closingInProgress
        ? "ERPNext is consolidating this shift. Sales remain blocked until it completes."
        : "The POS session could not be verified. Refresh and try again.";
    return <SessionMessage message={message} title={title} />;
  }

  return (
    <KeyboardAwareFormScroll
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.heading}>
        <Text style={[styles.title, { color: palette.onSurface }]}>
          Start POS shift
        </Text>
        <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
          Enter the opening balance for each payment mode in{" "}
          {posProfile || "your POS profile"}.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.cardTitle, { color: palette.onSurface }]}>
          Opening balances
        </Text>
        {paymentModes.map((mode) => (
          <View
            key={mode.mode_of_payment}
            style={[
              styles.paymentMode,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
              },
            ]}
          >
            <Text style={[styles.modeName, { color: palette.onSurface }]}>
              {mode.mode_of_payment}
            </Text>
            <View style={styles.amountField}>
              {currency ? (
                <Text
                  style={[styles.currency, { color: palette.onSurfaceMuted }]}
                >
                  {currency}
                </Text>
              ) : null}
              <TextInput
                accessibilityLabel={`${mode.mode_of_payment} opening balance`}
                editable={!opening.isOpening}
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  setAmounts((current) => ({
                    ...current,
                    [mode.mode_of_payment]: value,
                  }))
                }
                placeholder="0.00"
                placeholderTextColor={palette.onSurfaceMuted}
                style={[styles.amountInput, { color: palette.onSurface }]}
                value={amounts[mode.mode_of_payment] ?? ""}
              />
            </View>
          </View>
        ))}
        {!paymentModes.length ? (
          <Text style={[styles.message, { color: palette.error }]}>
            No payment modes are configured for this POS Profile. Ask an
            administrator to configure them before opening a shift.
          </Text>
        ) : null}
        {connectionStatus !== "online" ? (
          <Text style={[styles.message, { color: palette.error }]}>
            Reconnect to the server before opening this shift.
          </Text>
        ) : null}
        {validationError || opening.error ? (
          <Text style={[styles.message, { color: palette.error }]}>
            {validationError || opening.error}
          </Text>
        ) : null}
        <Pressable
          accessibilityLabel="Start POS shift"
          accessibilityState={{ disabled: !canOpen }}
          disabled={!canOpen}
          onPress={() => void submitOpening()}
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primary },
            !canOpen && styles.disabledButton,
          ]}
        >
          {opening.isOpening ? (
            <ActivityIndicator color={palette.onPrimary} />
          ) : (
            <Text
              style={[styles.primaryButtonLabel, { color: palette.onPrimary }]}
            >
              Start POS shift
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAwareFormScroll>
  );
}

function SessionMessage({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  const { palette } = useAppearance();
  return (
    <View style={[styles.centered, { backgroundColor: palette.background }]}>
      <View
        accessibilityRole="alert"
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.title, { color: palette.onSurface }]}>
          {title}
        </Text>
        <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  amountField: { alignItems: "center", flexDirection: "row", minWidth: 138 },
  amountInput: {
    flex: 1,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    textAlign: "right",
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  centered: {
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
  },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    justifyContent: "center",
    padding: spacing.lg,
  },
  currency: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  disabledButton: { opacity: 0.5 },
  heading: { gap: spacing.xs },
  message: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  modeName: {
    flex: 1,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
  },
  paymentMode: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primaryButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 22 },
});
