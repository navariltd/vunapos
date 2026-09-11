import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useErpNextRecord } from '@/features/pos/hooks/useErpNextRecord';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosErpNextRecordLinkProps = {
  doctype: string;
  name: string;
};

export function PosErpNextRecordLink({ doctype, name }: PosErpNextRecordLinkProps) {
  const { error, isOpening, openRecord } = useErpNextRecord();

  return (
    <View style={styles.content}>
      <Pressable accessibilityLabel="Open in ERPNext" disabled={isOpening} onPress={() => void openRecord({ doctype, name })} style={[styles.button, isOpening && styles.buttonDisabled]}>
        <MaterialCommunityIcons color={posDarkColors.onSurface} name="open-in-new" size={18} />
        <Text style={styles.buttonLabel}>{isOpening ? 'Opening ERPNext…' : 'Open in ERPNext'}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', alignSelf: 'flex-start', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  content: { gap: spacing.xs },
  error: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, lineHeight: typography.lineHeight.body },
});
