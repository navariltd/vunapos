import { Image, StyleSheet } from 'react-native';

import { radii } from '@/theme/tokens';

type BrandMarkProps = {
  size?: 'small' | 'large';
};

export function BrandMark({ size = 'large' }: BrandMarkProps) {
  const isLarge = size === 'large';

  return (
    <Image
      accessible={false}
      source={require('../../../assets/images/vuna-logo.png')}
      style={[styles.logo, isLarge ? styles.largeLogo : styles.smallLogo]}
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    borderRadius: radii.md,
  },
  largeLogo: {
    height: 84,
    width: 84,
  },
  smallLogo: {
    height: 36,
    width: 36,
  },
});
