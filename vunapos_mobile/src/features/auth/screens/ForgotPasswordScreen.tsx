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

export function ForgotPasswordScreen() {
  const { appearance, palette } = useAppearance();
  const router = useRouter();
  const { companyUrl, requestPasswordReset } = useAppSession();
  const [email, setEmail] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailHasError = attemptedSubmit && email.trim().length === 0;

  async function handleSubmit() {
    setAttemptedSubmit(true);
    setError(null);
    setMessage(null);
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(email);
      if (result.ok) {
        setMessage(
          "If an account matches this email address, password-reset instructions have been sent.",
        );
      } else {
        setError(result.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!companyUrl) return <Redirect href="/(auth)/company-url" />;

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
              Reset your password
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtitle, { color: palette.onSurfaceMuted }]}
            >
              Enter your email address and we’ll send password-reset
              instructions if it is registered.
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
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            error={emailHasError}
            keyboardType="email-address"
            label="Email address"
            mode="outlined"
            onChangeText={setEmail}
            outlineStyle={styles.inputOutline}
            returnKeyType="send"
            value={email}
          />
          <HelperText type="error" visible={emailHasError}>
            Enter your email address.
          </HelperText>
          {error ? (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          ) : null}
          {message ? (
            <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
              {message}
            </Text>
          ) : null}
          <Button
            contentStyle={styles.submitContent}
            disabled={isSubmitting}
            loading={isSubmitting}
            mode="contained"
            onPress={() => void handleSubmit()}
            style={styles.submitButton}
          >
            {isSubmitting ? "Sending…" : "Send reset instructions"}
          </Button>
          <Button
            mode="text"
            onPress={() => router.back()}
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
  message: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
    paddingHorizontal: spacing.xs,
  },
  submitButton: { borderRadius: radii.md, marginTop: spacing.sm },
  submitContent: { height: 46 },
  backButton: { alignSelf: "center" },
});
