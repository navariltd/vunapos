import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';

import { BrandMark } from '@/components/brand/BrandMark';
import { Screen } from '@/components/layout/Screen';
import { colors, spacing, typography } from '@/theme/tokens';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <Screen>
      <Appbar.Header elevated={false} style={styles.appbar}>
        <BrandMark size="small" />
        <View style={styles.titleGroup}>
          <Text style={styles.productName}>VunaPOS</Text>
          <Text style={styles.productContext}>Mobile</Text>
        </View>
      </Appbar.Header>
      <View style={styles.content}>{children}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  appbar: {
    backgroundColor: colors.surface.base,
    borderBottomColor: colors.border.subtle,
    borderBottomWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  titleGroup: {
    gap: 0,
  },
  productName: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
  },
  productContext: {
    color: colors.ink.muted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.compact,
  },
  content: {
    flex: 1,
  },
});
