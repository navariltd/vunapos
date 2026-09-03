import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { BrandMark } from '@/components/brand/BrandMark';
import { FadeIn } from '@/components/layout/FadeIn';
import { Screen } from '@/components/layout/Screen';
import { useAppSession } from '@/features/auth/AppSessionProvider';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function SignInScreen() {
  const router = useRouter();
  const { authState, companyUrl, signIn } = useAppSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const emailHasError = attemptedSubmit && email.trim().length === 0;
  const passwordHasError = attemptedSubmit && password.length === 0;

  async function handleSubmit() {
    setAttemptedSubmit(true);
    setSubmitError(null);

    if (!email.trim() || !password) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result.ok) {
        router.replace('/(app)');
      } else {
        setSubmitError(result.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!companyUrl) {
    return <Redirect href="/(auth)/company-url" />;
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <FadeIn style={styles.introduction}>
            <BrandMark />
            <View style={styles.heading}>
              <Text variant="headlineMedium" style={styles.title}>Welcome back</Text>
              <Text variant="bodyMedium" style={styles.subtitle}>Sign in to your VunaPOS workspace.</Text>
            </View>
          </FadeIn>

          <FadeIn delay={70} style={styles.formCard}>
            <Text variant="titleMedium" style={styles.formTitle}>Sign in</Text>
            {authState === 'sessionExpired' ? (
              <View style={styles.expiredSessionNotice}>
                <Text style={styles.expiredSessionText}>Your session has expired. Sign in again to continue.</Text>
              </View>
            ) : null}

            <View style={styles.fields}>
              <View>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect={false}
                  error={emailHasError}
                  label="Email, phone, or username"
                  mode="outlined"
                  onChangeText={setEmail}
                  outlineStyle={styles.inputOutline}
                  placeholder="Enter your sign-in ID"
                  returnKeyType="next"
                  value={email}
                />
                <HelperText type="error" visible={emailHasError}>Enter your sign-in ID.</HelperText>
              </View>

              <View>
                <TextInput
                  autoComplete="current-password"
                  error={passwordHasError}
                  label="Password"
                  mode="outlined"
                  onChangeText={setPassword}
                  outlineStyle={styles.inputOutline}
                  returnKeyType="done"
                  right={<TextInput.Icon icon={passwordVisible ? 'eye-off-outline' : 'eye-outline'} onPress={() => setPasswordVisible((visible) => !visible)} />}
                  secureTextEntry={!passwordVisible}
                  value={password}
                />
                <HelperText type="error" visible={passwordHasError}>Enter your password.</HelperText>
              </View>
            </View>

            {submitError ? <HelperText type="error" visible>{submitError}</HelperText> : null}

            <Button contentStyle={styles.submitContent} disabled={isSubmitting} loading={isSubmitting} mode="contained" onPress={() => void handleSubmit()} style={styles.submitButton}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button mode="text" onPress={() => router.push('/(auth)/company-url')} style={styles.changeCompanyButton}>
              Change company URL
            </Button>
          </FadeIn>

        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.xxxl,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  introduction: {
    gap: spacing.lg,
  },
  heading: {
    gap: spacing.xs,
  },
  title: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
    lineHeight: typography.lineHeight.heading,
  },
  subtitle: {
    color: colors.ink.secondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formCard: {
    backgroundColor: colors.surface.base,
    borderColor: colors.border.subtle,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  formTitle: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
  },
  expiredSessionNotice: {
    backgroundColor: colors.status.dangerSurface,
    borderColor: colors.status.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  expiredSessionText: {
    color: colors.status.dangerText,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  fields: {
    gap: spacing.xs,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  submitButton: {
    borderRadius: radii.md,
  },
  submitContent: {
    height: 46,
  },
  changeCompanyButton: {
    alignSelf: 'center',
  },
});
