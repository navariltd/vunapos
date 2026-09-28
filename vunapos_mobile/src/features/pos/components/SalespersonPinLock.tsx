import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { PosPinUser } from '@/features/pos/types';
import { useAppearance } from '@/theme/AppearanceProvider';
import { AppPalette, radii, spacing, typography } from '@/theme/tokens';

type SalespersonPinLockProps = {
  error: string | null;
  isVerifying: boolean;
  pinUsers?: PosPinUser[];
  posProfile?: string;
  visible: boolean;
  onVerify: (salesperson: string, pin: string) => Promise<boolean>;
};

/** A non-dismissible POS lock that verifies a server-issued salesperson token. */
export function SalespersonPinLock({ error, isVerifying, onVerify, pinUsers = [], posProfile, visible }: SalespersonPinLockProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const salespeople = pinUsers.filter((user) => user.role === 'Salesperson');
  const [selectedSalesperson, setSelectedSalesperson] = useState('');
  const [pin, setPin] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const activeSalesperson = salespeople.some((user) => user.sales_person === selectedSalesperson)
    ? selectedSalesperson
    : salespeople[0]?.sales_person || '';

  async function verify() {
    if (!posProfile || !activeSalesperson || !/^\d{4,6}$/.test(pin)) {
      setValidationError('Select a salesperson and enter a 4 to 6 digit PIN.');
      return;
    }
    setValidationError(null);
    if (await onVerify(activeSalesperson, pin)) setPin('');
  }

  return <Modal animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
    <View style={styles.backdrop}>
      <KeyboardAwareFormScroll contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.headingRow}>
            <View style={styles.iconWrap}><MaterialCommunityIcons color={palette.onPrimary} name="lock-outline" size={26} /></View>
            <View style={styles.heading}>
              <Text style={styles.title}>Select salesperson</Text>
              <Text style={styles.subtitle}>Enter the salesperson PIN to unlock this POS.</Text>
            </View>
          </View>
          {salespeople.length ? <>
            <Text style={styles.fieldLabel}>Salesperson</Text>
            <View style={styles.salespersonList}>
              {salespeople.map((salesperson) => {
                const selected = salesperson.sales_person === activeSalesperson;
                return <Pressable
                  accessibilityLabel={`Select salesperson ${salesperson.display_name || salesperson.sales_person}`}
                  accessibilityState={{ selected }}
                  disabled={isVerifying}
                  key={salesperson.sales_person}
                  onPress={() => setSelectedSalesperson(salesperson.sales_person)}
                  style={[styles.salespersonOption, selected && styles.salespersonOptionSelected]}
                >
                  <Text style={styles.salespersonName}>{salesperson.display_name || salesperson.sales_person}</Text>
                  {selected ? <MaterialCommunityIcons color={palette.primary} name="check-circle" size={21} /> : null}
                </Pressable>;
              })}
            </View>
            <Text style={styles.fieldLabel}>PIN</Text>
            <TextInput
              accessibilityLabel="Salesperson PIN"
              autoFocus
              editable={!isVerifying}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
              onSubmitEditing={() => void verify()}
              placeholder="••••"
              placeholderTextColor={palette.onSurfaceMuted}
              secureTextEntry
              style={styles.pinInput}
              value={pin}
            />
            {validationError || error ? <Text style={styles.errorText}>{validationError || error}</Text> : null}
            <Pressable accessibilityLabel="Unlock POS" disabled={isVerifying || !activeSalesperson || pin.length < 4} onPress={() => void verify()} style={[styles.unlockButton, (isVerifying || !activeSalesperson || pin.length < 4) && styles.unlockButtonDisabled]}>
              {isVerifying ? <ActivityIndicator color={palette.onPrimary} size="small" /> : <Text style={styles.unlockLabel}>Unlock POS</Text>}
            </Pressable>
          </> : <Text style={styles.errorText}>No enabled salesperson PIN is configured for this POS Profile.</Text>}
        </View>
      </KeyboardAwareFormScroll>
    </View>
  </Modal>;
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  backdrop: { backgroundColor: palette.scrim, flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  dialog: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radii.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  errorText: { color: palette.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  fieldLabel: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  heading: { flex: 1, gap: 2 },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  iconWrap: { alignItems: 'center', backgroundColor: palette.primary, borderRadius: radii.pill, height: 48, justifyContent: 'center', width: 48 },
  pinInput: { backgroundColor: palette.surfaceContainer, borderColor: palette.border, borderRadius: radii.md, borderWidth: 1, color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 22, letterSpacing: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, textAlign: 'center' },
  salespersonList: { gap: spacing.xs },
  salespersonName: { color: palette.onSurface, flex: 1, fontFamily: typography.fontFamily.medium, fontSize: typography.size.body },
  salespersonOption: { alignItems: 'center', backgroundColor: palette.surfaceContainer, borderColor: palette.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.sm },
  salespersonOptionSelected: { borderColor: palette.primary },
  subtitle: { color: palette.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  title: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  unlockButton: { alignItems: 'center', backgroundColor: palette.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  unlockButtonDisabled: { opacity: 0.45 },
  unlockLabel: { color: palette.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  });
}
