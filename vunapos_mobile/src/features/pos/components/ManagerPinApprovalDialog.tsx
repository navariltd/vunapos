import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import { useAppSession } from "@/features/auth/AppSessionProvider";
import { FrappeClientError, postVunaMethod } from "@/services/frappeClient";
import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type Props = {
  isOffline?: boolean;
  onApproved: (token: string) => void;
  onDismiss: () => void;
  posProfile?: string;
  visible: boolean;
};

type Verification = { token: string };

/** Requires a server-verified manager PIN before a profile-protected cart removal. */
export function ManagerPinApprovalDialog({
  isOffline = false,
  onApproved,
  onDismiss,
  posProfile,
  visible,
}: Props) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pin, setPin] = useState("");

  async function verify() {
    if (!posProfile || !/^\d{4,6}$/.test(pin)) {
      setError("Enter a 4 to 6 digit manager PIN.");
      return;
    }
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return;
    }
    setError(null);
    setIsVerifying(true);
    try {
      const verification = await postVunaMethod<Verification>(
        companyUrl,
        sessionId,
        "vunapos.api.pin.verify_manager",
        { action: "item_removal", pin, pos_profile: posProfile },
      );
      setPin("");
      onApproved(verification.token);
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      )
        void invalidateSession();
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Manager PIN verification failed.",
      );
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <KeyboardAwareFormScroll
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text style={styles.title}>Manager approval required</Text>
            <Text style={styles.subtitle}>
              Enter a manager PIN before removing this item from the cart.
            </Text>
            <TextInput
              accessibilityLabel="Manager PIN"
              autoFocus
              editable={!isOffline && !isVerifying}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value) => setPin(value.replace(/\D/g, ""))}
              onSubmitEditing={() => void verify()}
              placeholder="••••"
              placeholderTextColor={palette.onSurfaceMuted}
              secureTextEntry
              style={styles.pinInput}
              value={pin}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel="Cancel manager approval"
                disabled={isVerifying}
                onPress={onDismiss}
                style={[styles.cancelButton, isVerifying && styles.disabled]}
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Approve item removal"
                disabled={isOffline || isVerifying || pin.length < 4}
                onPress={() => void verify()}
                style={[
                  styles.approveButton,
                  (isOffline || isVerifying || pin.length < 4) && styles.disabled,
                ]}
              >
                {isVerifying ? (
                  <ActivityIndicator
                    color={palette.onPrimary}
                    size="small"
                  />
                ) : (
                  <Text style={styles.approveLabel}>Approve</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAwareFormScroll>
      </View>
    </Modal>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  approveButton: {
    alignItems: "center",
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: spacing.md,
  },
  approveLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  backdrop: { backgroundColor: palette.scrim, flex: 1 },
  cancelButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  cancelLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  dialog: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  disabled: { opacity: 0.45 },
  error: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  pinInput: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 22,
    letterSpacing: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  title: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  });
}
