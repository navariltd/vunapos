import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosCustomerDetails } from '@/features/pos/hooks/usePosCustomerDetails';
import { PosCustomerAddress, PosSaleCustomer } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosCustomerDetailsScreenProps = {
  customer: string;
  onBack: () => void;
  onStartSale: (customer: PosSaleCustomer) => void;
};

function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
}

function formatAddress(address?: PosCustomerAddress | null) {
  if (!address) return null;

  return [
    address.address_line1,
    address.address_line2,
    address.city,
    address.state,
    address.country,
    address.pincode,
  ].filter(Boolean).join(', ') || null;
}

function DetailCard({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}

function SummaryValue({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <View style={styles.summaryValue}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryText}>{value}</Text>
      {sub ? <Text numberOfLines={1} style={styles.summarySubtext}>{sub}</Text> : null}
    </View>
  );
}

export function PosCustomerDetailsScreen({ customer, onBack, onStartSale }: PosCustomerDetailsScreenProps) {
  const bootstrap = usePosBootstrap();
  const details = usePosCustomerDetails({ customer, posProfile: bootstrap.data?.pos_profile.name });
  const error = bootstrap.error ?? details.error;

  if (bootstrap.isLoading || details.isLoading) {
    return <View style={styles.state}><Text style={styles.stateText}>Loading customer details…</Text></View>;
  }

  if (!details.data || error) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{error || 'Customer not found.'}</Text>
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backButtonLabel}>Back to invoice</Text></Pressable>
      </View>
    );
  }

  const { customer: profile } = details.data;
  const currency = profile.currency ?? bootstrap.data?.pos_profile.currency ?? 'KES';
  const phone = profile.mobile_no || details.data.contact?.mobile_no || details.data.contact?.phone;
  const email = profile.email_id || details.data.contact?.email_id;
  const address = formatAddress(details.data.address);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to invoice" onPress={onBack} style={styles.backIconButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurface} name="arrow-left" size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text numberOfLines={1} style={styles.title}>{profile.customer_name}</Text>
          <Text style={styles.subtitle}>{profile.customer} · {profile.customer_group || 'Uncategorized'}</Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryValue label="Current balance" value={formatCurrency(details.data.balance, currency)} />
        <SummaryValue label="Loyalty points" sub={details.data.loyalty?.tier || details.data.loyalty?.program} value={details.data.loyalty ? details.data.loyalty.points.toLocaleString() : 'Not enrolled'} />
        <SummaryValue label="Customer type" sub={profile.territory} value={profile.customer_type || '-'} />
      </View>

      <DetailCard title="Contact information">
        <Text style={styles.detailText}>{phone || 'No phone number'}</Text>
        <Text style={styles.detailText}>{email || 'No email address'}</Text>
        {profile.tax_id ? <Text style={styles.detailText}>Tax ID: {profile.tax_id}</Text> : null}
      </DetailCard>

      <DetailCard title="Primary address">
        <Text style={styles.detailText}>{address || 'No permitted primary address available.'}</Text>
      </DetailCard>

      <Pressable accessibilityLabel="Start new sale" onPress={() => onStartSale({ customer: profile.customer, customerName: profile.customer_name, isWalkin: profile.is_walkin, mobile: phone, taxId: profile.tax_id })} style={styles.startSaleButton}>
        <Text style={styles.startSaleButtonLabel}>Start new sale</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  backIconButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  card: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  detailText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, textAlign: 'center' },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 4 },
  state: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', padding: spacing.lg },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  startSaleButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', padding: spacing.md },
  startSaleButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  summarySubtext: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  summaryText: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  summaryValue: { backgroundColor: posDarkColors.surfaceContainer, borderRadius: radii.md, flexBasis: '47%', flexGrow: 1, gap: 4, padding: spacing.sm },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
