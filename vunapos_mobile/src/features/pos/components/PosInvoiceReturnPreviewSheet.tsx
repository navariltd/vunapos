import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoiceReturnPreviewSheetProps = {
  currency: string;
  invoiceName: string;
  onDismiss: () => void;
  posProfile: string;
  visible: boolean;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', maximumFractionDigits: 2, minimumFractionDigits: 2, style: 'currency' }).format(amount);
}

function formatQuantity(quantity: number, uom?: string | null) {
  return `${quantity} ${uom || ''}`.trim();
}

/** Read-only first step: server-authoritative quantities for a proposed return. */
export function PosInvoiceReturnPreviewSheet({ currency, invoiceName, onDismiss, posProfile, visible }: PosInvoiceReturnPreviewSheetProps) {
  const insets = useSafeAreaInsets();
  const preview = useInvoiceReturnPreview({ enabled: visible, invoiceName, posProfile });
  const displayCurrency = preview.data?.currency || currency;
  const returnableItems = preview.data?.items.filter((item) => item.returnable_qty > 0) ?? [];

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss return items" onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={styles.title}>Return items</Text>
                <Text style={styles.subtitle}>Review what is still available to return.</Text>
              </View>
              <Pressable accessibilityLabel="Close return items" onPress={onDismiss} style={styles.closeButton}><Text style={styles.closeButtonLabel}>Close</Text></Pressable>
            </View>

            {preview.isLoading ? <View style={styles.state}><Text style={styles.stateText}>Preparing return…</Text></View> : null}
            {preview.error ? <View style={styles.state}><Text style={styles.errorText}>{preview.error}</Text></View> : null}
            {preview.data ? (
              <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} showsVerticalScrollIndicator={false}>
                {returnableItems.length ? returnableItems.map((item) => (
                  <View key={item.row_name} style={styles.item}>
                    <View style={styles.itemHeading}>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemName}>{item.item_name}</Text>
                        <Text style={styles.itemCode}>{item.item_code}</Text>
                      </View>
                      <Text style={styles.itemAmount}>{formatCurrency(item.return_amount, displayCurrency)}</Text>
                    </View>
                    <View style={styles.quantities}>
                      <Text style={styles.quantity}>Sold {formatQuantity(item.sold_qty, item.uom)}</Text>
                      <Text style={styles.quantity}>Returned {formatQuantity(item.returned_qty, item.uom)}</Text>
                      <Text style={styles.available}>Available {formatQuantity(item.returnable_qty, item.uom)}</Text>
                    </View>
                  </View>
                )) : <View style={styles.state}><Text style={styles.stateText}>All items on this invoice have already been returned.</Text></View>}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  available: { color: '#86efac', fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.6)', ...StyleSheet.absoluteFill },
  closeButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  closeButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  content: { gap: spacing.sm, paddingTop: spacing.md },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  handle: { alignSelf: 'center', backgroundColor: '#555', borderRadius: radii.pill, height: 4, marginTop: spacing.xs, width: 40 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  heading: { flex: 1, gap: 4 },
  item: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  itemAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  itemCode: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  itemHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  itemMain: { flex: 1, gap: 2 },
  itemName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  keyboardView: { justifyContent: 'flex-end', maxHeight: '100%' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  quantities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quantity: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  sheet: { backgroundColor: posDarkColors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, flexShrink: 1, maxHeight: '88%', paddingHorizontal: spacing.md },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
