import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { colors, radii, typography } from '@/theme/tokens';

type BrandMarkProps = {
  size?: 'small' | 'large';
};

export function BrandMark({ size = 'large' }: BrandMarkProps) {
  const isLarge = size === 'large';

  return (
    <View style={[styles.mark, isLarge ? styles.largeMark : styles.smallMark]}>
      <Text style={[styles.letter, isLarge ? styles.largeLetter : styles.smallLetter]}>V</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    backgroundColor: colors.ink.primary,
    borderRadius: radii.md,
    justifyContent: 'center',
  },
  largeMark: {
    height: 52,
    width: 52,
  },
  smallMark: {
    height: 32,
    width: 32,
  },
  letter: {
    color: colors.surface.base,
    fontFamily: typography.fontFamily.semibold,
    includeFontPadding: false,
  },
  largeLetter: {
    fontSize: 24,
    lineHeight: 28,
  },
  smallLetter: {
    fontSize: 15,
    lineHeight: 18,
  },
});
