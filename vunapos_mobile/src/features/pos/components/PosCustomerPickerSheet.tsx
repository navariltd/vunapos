import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { usePosCustomerSearch } from '@/features/pos/hooks/usePosCustomerSearch';
import { PosCustomerSearchResult } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosCustomerPickerSheetProps = {
  onDismiss: () => void;
  onSelect: (customer: PosCustomerSearchResult) => void;
  visible: boolean;
};

/** Native customer selection is deliberately available from the cart before checkout. */
export function PosCustomerPickerSheet({ onDismiss, onSelect, visible }: PosCustomerPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const search = usePosCustomerSearch(query, visible);

  function select(customer: PosCustomerSearchResult) {
    onSelect(customer);
    setQuery('');
    onDismiss();
  }

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss customer picker" onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}><Text style={styles.title}>Select customer</Text><Text style={styles.subtitle}>Search by customer, phone, or email.</Text></View>
              <Pressable accessibilityLabel="Close customer picker" onPress={onDismiss} style={styles.closeButton}><Text style={styles.closeButtonLabel}>Close</Text></Pressable>
            </View>
            <View style={styles.searchField}>
              <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="magnify" size={20} />
              <TextInput accessibilityLabel="Search customers" autoFocus onChangeText={setQuery} placeholder="Search customers" placeholderTextColor="#8f8f8f" style={styles.searchInput} value={query} />
            </View>
            <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {search.isLoading ? <Text style={styles.stateText}>Loading customers…</Text> : null}
              {search.error ? <Text style={styles.errorText}>{search.error}</Text> : null}
              {!search.isLoading && !search.error && !search.rows.length ? <Text style={styles.stateText}>No customers found.</Text> : null}
              {search.rows.map((customer) => <Pressable accessibilityLabel={`Select customer ${customer.customerName}`} key={customer.customer} onPress={() => select(customer)} style={styles.customerRow}>
                <View style={styles.customerMain}><Text style={styles.customerName}>{customer.customerName}</Text><Text style={styles.customerMeta}>{customer.mobile || customer.email || customer.customer}</Text></View>
                <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="chevron-right" size={20} />
              </Pressable>)}
            </ScrollView>
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
  sheet: { backgroundColor: posDarkColors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, flexShrink: 1, maxHeight: '88%', paddingHorizontal: spacing.md },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, paddingVertical: spacing.sm, textAlign: 'center' },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
