import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Chip, Divider, Text } from 'react-native-paper';

import { AppShell } from '@/features/shell/components/AppShell';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const upcomingAreas = ['Weighing', 'Quality checks', 'History'];

export function AppSkeletonScreen() {
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>APP SHELL</Text>
          <Text variant="headlineSmall" style={styles.title}>Your workspace is ready.</Text>
          <Text variant="bodyMedium" style={styles.subtitle}>Feature areas will be added here one at a time.</Text>
        </View>

        <Card mode="contained" style={styles.statusCard}>
          <Card.Content style={styles.statusContent}>
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Ready to connect</Text>
            </View>
            <Text style={styles.statusDescription}>Authentication and live data are the next increments.</Text>
          </Card.Content>
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coming next</Text>
          <View style={styles.chips}>
            {upcomingAreas.map((area) => <Chip key={area} compact style={styles.chip}>{area}</Chip>)}
          </View>
        </View>

        <Divider />
        <Text style={styles.footer}>This is the shared native shell for future mobile workflows.</Text>
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    padding: spacing.xl,
  },
  heading: {
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.ink.muted,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    letterSpacing: 0.8,
  },
  title: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
  },
  subtitle: {
    color: colors.ink.secondary,
    fontFamily: typography.fontFamily.regular,
  },
  statusCard: {
    backgroundColor: colors.surface.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  statusContent: {
    gap: spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusDot: {
    backgroundColor: colors.status.success,
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  statusText: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.medium,
  },
  statusDescription: {
    color: colors.ink.secondary,
    fontFamily: typography.fontFamily.regular,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.ink.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surface.subtle,
  },
  footer: {
    color: colors.ink.muted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
});
