import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosItemSearchProps = {
  onChangeText: (value: string) => void;
  value: string;
};

export function PosItemSearch({ onChangeText, value }: PosItemSearchProps) {
  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="magnify" size={20} />
        <TextInput
          accessibilityLabel="Search items"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChangeText}
          placeholder="Search by item name, code, or barcode"
          placeholderTextColor="#8f8f8f"
          style={styles.input}
          value={value}
        />
      </View>
      <Pressable accessibilityLabel="Scan barcode with camera" style={styles.cameraButton}>
        <MaterialCommunityIcons color={posDarkColors.onSurface} name="camera-outline" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraButton: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  container: {
    backgroundColor: posDarkColors.background,
    borderBottomColor: posDarkColors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  input: {
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: '100%',
    paddingVertical: 0,
  },
  inputContainer: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
});
