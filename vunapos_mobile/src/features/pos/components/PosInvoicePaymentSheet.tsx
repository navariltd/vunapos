import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { useReceiveInvoicePayment } from '@/features/pos/hooks/useReceiveInvoicePayment';
import { PosBootstrapData } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoicePaymentSheetProps = {
  currency: string;
  customer: string;
  invoice: string;
  onComplete: () => void;
  onDismiss: () => void;
  outstandingAmount: number;
  paymentModes: PosBootstrapData['payment_modes'];
  posProfile: string;
  visible: boolean;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function PosInvoicePaymentSheet({
  currency,
  customer,
  invoice,
  onComplete,
  onDismiss,
  outstandingAmount,
  paymentModes,
  posProfile,
  visible,
}: PosInvoicePaymentSheetProps) {
  const insets = useSafeAreaInsets();
  const availableModes = paymentModes.filter((mode) => !mode.payment_gateway);
  const defaultMode = availableModes.find((mode) => mode.default)?.mode_of_payment || availableModes[0]?.mode_of_payment || '';
  const [amount, setAmount] = useState(String(outstandingAmount));
  const [mode, setMode] = useState(defaultMode);
  const [referenceDate, setReferenceDate] = useState(today());
  const [referenceNo, setReferenceNo] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [paymentName, setPaymentName] = useState<string | null>(null);
  const { error, isSubmitting, receive } = useReceiveInvoicePayment();
  const selectedMode = availableModes.find((paymentMode) => paymentMode.mode_of_payment === mode);
  const requiresReference = selectedMode?.type === 'Bank';

  async function submitPayment() {
    const paymentAmount = Number(amount);
    setValidationError(null);
    if (!mode) {
      setValidationError('No manual payment mode is available for this POS profile.');
      return;
    }
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setValidationError('Enter a payment amount greater than zero.');
      return;
    }
    if (paymentAmount > outstandingAmount) {
      setValidationError('The payment cannot exceed the invoice outstanding balance.');
      return;
    }
    if (requiresReference && (!referenceNo.trim() || !referenceDate)) {
      setValidationError('Reference number and date are required for bank payments.');
      return;
    }

    const payment = await receive({
      amount: paymentAmount,
      customer,
      invoice,
      modeOfPayment: mode,
      posProfile,
      referenceDate: requiresReference ? referenceDate : undefined,
      referenceNo: requiresReference ? referenceNo.trim() : undefined,
    });
    if (payment) {
      setPaymentName(payment.name);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss receive payment" disabled={isSubmitting} onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={styles.title}>Receive payment</Text>
                <Text style={styles.subtitle}>{invoice} · Outstanding {formatCurrency(outstandingAmount, currency)}</Text>
              </View>
              <Pressable accessibilityLabel="Close receive payment" disabled={isSubmitting} onPress={onDismiss} style={styles.closeButton}>
                <Text style={styles.closeButtonLabel}>Close</Text>
              </Pressable>
            </View>

            {paymentName ? (
              <View style={styles.successState}>
                <Text style={styles.successTitle}>Payment received</Text>
                <Text style={styles.successText}>Payment Entry {paymentName} was submitted successfully.</Text>
                <Pressable accessibilityLabel="Finish receiving payment" onPress={onComplete} style={styles.submitButton}>
                  <Text style={styles.submitButtonLabel}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>Amount</Text>
                <TextInput
                  accessibilityLabel="Payment amount"
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor="#8f8f8f"
                  style={styles.input}
                  value={amount}
                />

                <Text style={styles.label}>Payment mode</Text>
                {availableModes.length ? (
                  <View style={styles.modeOptions}>
                    {availableModes.map((paymentMode) => (
                      <Pressable
                        key={paymentMode.mode_of_payment}
                        accessibilityLabel={`Payment mode ${paymentMode.mode_of_payment}`}
                        onPress={() => setMode(paymentMode.mode_of_payment)}
                        style={[styles.modeOption, mode === paymentMode.mode_of_payment && styles.modeOptionActive]}
                      >
                        <Text style={[styles.modeOptionLabel, mode === paymentMode.mode_of_payment && styles.modeOptionLabelActive]}>{paymentMode.mode_of_payment}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : <Text style={styles.errorText}>No manual payment mode is configured for this POS profile.</Text>}

                {requiresReference ? (
                  <>
                    <Text style={styles.label}>Reference number</Text>
                    <TextInput accessibilityLabel="Payment reference number" onChangeText={setReferenceNo} placeholder="Reference number" placeholderTextColor="#8f8f8f" style={styles.input} value={referenceNo} />
                    <Text style={styles.label}>Reference date</Text>
                    <TextInput accessibilityLabel="Payment reference date" autoCapitalize="none" onChangeText={setReferenceDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8f8f8f" style={styles.input} value={referenceDate} />
                  </>
                ) : null}

                {validationError || error ? <Text style={styles.errorText}>{validationError || error}</Text> : null}
                <Pressable accessibilityLabel="Submit invoice payment" disabled={isSubmitting || !availableModes.length} onPress={() => void submitPayment()} style={[styles.submitButton, (isSubmitting || !availableModes.length) && styles.submitButtonDisabled]}>
                  <Text style={styles.submitButtonLabel}>{isSubmitting ? 'Receiving payment…' : 'Receive payment'}</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.6)', ...StyleSheet.absoluteFill },
  closeButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  closeButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  content: { gap: spacing.sm, paddingTop: spacing.md },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  handle: { alignSelf: 'center', backgroundColor: '#555', borderRadius: radii.pill, height: 4, marginTop: spacing.xs, width: 40 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  heading: { flex: 1, gap: 4 },
  input: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  keyboardView: { justifyContent: 'flex-end', maxHeight: '100%' },
  label: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, marginTop: spacing.xs },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modeOption: { borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  modeOptionActive: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  modeOptionLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  modeOptionLabelActive: { color: posDarkColors.onPrimary },
  modeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  sheet: { backgroundColor: posDarkColors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '88%', paddingHorizontal: spacing.md },
  submitButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', marginTop: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
  submitButtonDisabled: { opacity: 0.45 },
  submitButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  successState: { gap: spacing.md, paddingVertical: spacing.xl },
  successText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  successTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
