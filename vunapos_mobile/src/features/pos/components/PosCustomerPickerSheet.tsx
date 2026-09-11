import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { useCreatePosCustomer } from '@/features/pos/hooks/useCreatePosCustomer';
import { usePosCustomerSearch } from '@/features/pos/hooks/usePosCustomerSearch';
import { PosCustomerSearchResult } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosCustomerPickerSheetProps = {
  allowCustomerCreation: boolean;
  onDismiss: () => void;
  onSelect: (customer: PosCustomerSearchResult) => void;
  posProfile?: string;
  visible: boolean;
};

/** Native customer selection is deliberately available from the cart before checkout. */
export function PosCustomerPickerSheet({ allowCustomerCreation, onDismiss, onSelect, posProfile, visible }: PosCustomerPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [customerName, setCustomerName] = useState('');
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const customerCreation = useCreatePosCustomer();
  const search = usePosCustomerSearch(query, visible);

  function select(customer: PosCustomerSearchResult) {
    onSelect(customer);
    setQuery('');
    onDismiss();
  }

  async function createCustomer() {
    const customer = await customerCreation.create(customerName, posProfile);
    if (!customer) return;
    setCustomerName('');
    setShowCreate(false);
    select(customer);
  }

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss customer picker" onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <KeyboardAwareFormScroll
            accessibilityViewIsModal
            contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
            showsVerticalScrollIndicator={false}
            style={styles.sheet}
          >
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}><Text style={styles.title}>Select customer</Text><Text style={styles.subtitle}>Search by customer, phone, or email.</Text></View>
              <Pressable accessibilityLabel="Close customer picker" onPress={onDismiss} style={styles.closeButton}><Text style={styles.closeButtonLabel}>Close</Text></Pressable>
            </View>
            <View style={styles.searchField}>
              <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="magnify" size={20} />
              <TextInput accessibilityLabel="Search customers" autoFocus onChangeText={setQuery} placeholder="Search customers" placeholderTextColor="#8f8f8f" style={styles.searchInput} value={query} />
            </View>
            <View style={styles.list}>
              {search.isLoading ? <Text style={styles.stateText}>Loading customers…</Text> : null}
              {search.error ? <Text style={styles.errorText}>{search.error}</Text> : null}
              {!search.isLoading && !search.error && !search.rows.length ? <Text style={styles.stateText}>No customers found.</Text> : null}
              {search.rows.map((customer) => <Pressable accessibilityLabel={`Select customer ${customer.customerName}`} key={customer.customer} onPress={() => select(customer)} style={styles.customerRow}>
                <View style={styles.customerMain}><Text style={styles.customerName}>{customer.customerName}</Text><Text style={styles.customerMeta}>{customer.mobile || customer.email || customer.customer}</Text></View>
                <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="chevron-right" size={20} />
              </Pressable>)}
            </View>
            {allowCustomerCreation ? (
              <View style={styles.createSection}>
                <Pressable accessibilityLabel="Create customer" disabled={customerCreation.isCreating} onPress={() => setShowCreate((current) => !current)} style={styles.createToggle}>
                  <MaterialCommunityIcons color={posDarkColors.primary} name="plus" size={19} />
                  <Text style={styles.createToggleLabel}>Create customer</Text>
                </Pressable>
                {showCreate ? (
                  <View style={styles.createForm}>
                    <TextInput accessibilityLabel="New customer name" autoCapitalize="words" editable={!customerCreation.isCreating} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor="#8f8f8f" style={styles.createInput} value={customerName} />
                    {customerCreation.error ? <Text accessibilityRole="alert" style={styles.errorText}>{customerCreation.error}</Text> : null}
                    <Pressable accessibilityLabel="Save customer" disabled={customerCreation.isCreating || !customerName.trim()} onPress={() => { void createCustomer(); }} style={[styles.saveButton, (customerCreation.isCreating || !customerName.trim()) && styles.saveButtonDisabled]}>
                      <Text style={styles.saveButtonLabel}>{customerCreation.isCreating ? 'Creating…' : 'Save customer'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
          </KeyboardAwareFormScroll>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.6)', ...StyleSheet.absoluteFill },
  closeButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  closeButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  createForm: { gap: spacing.sm },
  createInput: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  createSection: { borderTopColor: posDarkColors.border, borderTopWidth: 1, gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.md },
  createToggle: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, minHeight: 40, paddingHorizontal: spacing.xs },
  createToggleLabel: { color: posDarkColors.primary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  customerMain: { flex: 1, gap: 3 },
  customerMeta: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  customerName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  customerRow: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  handle: { alignSelf: 'center', backgroundColor: '#555', borderRadius: radii.pill, height: 4, marginTop: spacing.xs, width: 40 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  heading: { flex: 1, gap: 3 },
  keyboardView: { justifyContent: 'flex-end', maxHeight: '100%' },
  list: { gap: spacing.sm, paddingBottom: spacing.md, paddingTop: spacing.md },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  searchField: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, paddingHorizontal: spacing.sm },
  searchInput: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingVertical: spacing.sm },
  saveButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.md },
  saveButtonDisabled: { backgroundColor: posDarkColors.disabled, opacity: 0.5 },
  saveButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  sheet: { backgroundColor: posDarkColors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, flexShrink: 1, maxHeight: '88%' },
  sheetContent: { paddingHorizontal: spacing.md },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, paddingVertical: spacing.sm, textAlign: 'center' },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
