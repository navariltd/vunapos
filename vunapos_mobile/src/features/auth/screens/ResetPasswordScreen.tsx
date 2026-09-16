import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { BrandMark } from "@/components/brand/BrandMark";
import { FadeIn } from "@/components/layout/FadeIn";
import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import { Screen } from "@/components/layout/Screen";
import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

export function ResetPasswordScreen() {
  const { appearance, palette } = useAppearance();
  const router = useRouter();
  const { completePasswordReset, companyUrl, hasPendingPasswordReset } =
    useAppSession();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const newPasswordHasError = attemptedSubmit && !newPassword;
  const confirmPasswordHasError =
    attemptedSubmit && (!confirmPassword || newPassword !== confirmPassword);

  async function handleSubmit() {
    setAttemptedSubmit(true);
    setSubmitError(null);
    if (!newPassword || newPassword !== confirmPassword) return;

    setIsSubmitting(true);
    try {
      const result = await completePasswordReset(newPassword);
      if (result.ok) {
        router.replace("/(app)");
      } else {
        setSubmitError(result.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!companyUrl || !hasPendingPasswordReset)
    return <Redirect href="/(auth)/sign-in" />;

  return (
    <Screen>
      <KeyboardAwareFormScroll contentContainerStyle={styles.content}>
        <FadeIn style={styles.introduction}>
          <BrandMark />
          <View style={styles.heading}>
            <Text
              variant="headlineMedium"
              style={[styles.title, { color: palette.onSurface }]}
            >
              Set a new password
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
            >
              Your password has expired. Choose a new password to continue to
              VunaPOS.
            </Text>
          </View>
        </FadeIn>

        <FadeIn
          delay={70}
          style={[
            styles.formCard,
            {
              backgroundColor: palette.surface,
              borderColor: palette.borderSubtle,
              shadowOpacity: appearance === "dark" ? 0 : 0.08,
            },
          ]}
        >
          <TextInput
            autoComplete="new-password"
            error={newPasswordHasError}
            label="New password"
            mode="outlined"
            onChangeText={setNewPassword}
            outlineStyle={styles.inputOutline}
            secureTextEntry
            value={newPassword}
          />
          <HelperText type="error" visible={newPasswordHasError}>
            Enter a new password.
          </HelperText>
          <TextInput
            autoComplete="new-password"
            error={confirmPasswordHasError}
            label="Confirm new password"
            mode="outlined"
            onChangeText={setConfirmPassword}
            outlineStyle={styles.inputOutline}
            returnKeyType="done"
            secureTextEntry
            value={confirmPassword}
          />
          <HelperText type="error" visible={confirmPasswordHasError}>
            {newPassword !== confirmPassword && confirmPassword
              ? "Passwords do not match."
              : "Confirm your new password."}
          </HelperText>
          {submitError ? (
            <HelperText type="error" visible>
              {submitError}
            </HelperText>
          ) : null}
          <Button
            contentStyle={styles.submitContent}
            disabled={isSubmitting}
            loading={isSubmitting}
            mode="contained"
            onPress={() => void handleSubmit()}
            style={styles.submitButton}
          >
            {isSubmitting ? "Updating…" : "Set new password"}
          </Button>
          <Button
            mode="text"
            onPress={() => router.replace("/(auth)/sign-in")}
            style={styles.backButton}
          >
            Back to sign in
          </Button>
        </FadeIn>
      </KeyboardAwareFormScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.xxxl,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  introduction: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
    lineHeight: typography.lineHeight.heading,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    shadowColor: "#000000",
    shadowOffset: { height: 1, width: 0 },
    shadowRadius: 3,
  },
  inputOutline: { borderRadius: radii.md },
  submitButton: { borderRadius: radii.md, marginTop: spacing.sm },
  submitContent: { height: 46 },
  backButton: { alignSelf: "center" },
});
