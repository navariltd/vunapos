import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { BrandMark } from '@/components/brand/BrandMark';
import { FadeIn } from '@/components/layout/FadeIn';
import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { Screen } from '@/components/layout/Screen';
import { useAppSession } from '@/features/auth/AppSessionProvider';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function CompanyUrlScreen() {
  const router = useRouter();
  const { companyUrl, saveCompanyUrl } = useAppSession();
  const [url, setUrl] = useState(companyUrl ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleContinue() {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const result = await saveCompanyUrl(url);
      if (result.ok) {
        router.replace('/(auth)/sign-in');
      } else {
        setSubmitError(result.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAwareFormScroll contentContainerStyle={styles.content} style={styles.keyboardView}>
          <FadeIn style={styles.introduction}>
            <BrandMark />
            <View style={styles.heading}>
              <Text variant="headlineMedium" style={styles.title}>Set up your workspace</Text>
              <Text variant="bodyMedium" style={styles.subtitle}>Enter your company’s VunaPOS address to get started.</Text>
            </View>
          </FadeIn>

          <FadeIn delay={70} style={styles.formCard}>
            <Text variant="titleMedium" style={styles.formTitle}>Company URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              label="Company URL"
              mode="outlined"
              onChangeText={setUrl}
              outlineStyle={styles.inputOutline}
              placeholder="https://yourcompany.example.com"
              value={url}
            />
            {submitError ? <HelperText type="error" visible>{submitError}</HelperText> : null}
            <Button contentStyle={styles.submitContent} disabled={!url.trim() || isSubmitting} loading={isSubmitting} mode="contained" onPress={() => void handleContinue()} style={styles.submitButton}>
              {isSubmitting ? 'Checking URL…' : 'Continue'}
            </Button>
          </FadeIn>
      </KeyboardAwareFormScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  keyboardView: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: spacing.xxxl,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  introduction: { gap: spacing.lg },
  heading: { gap: spacing.xs },
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
    gap: spacing.sm,
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
  inputOutline: { borderRadius: radii.md },
  submitButton: { borderRadius: radii.md },
  submitContent: { height: 46 },
});
