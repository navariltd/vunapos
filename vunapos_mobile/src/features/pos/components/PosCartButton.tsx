import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from 'react-native-paper';

import { posDarkColors, radii } from '@/theme/tokens';

type PosCartButtonProps = {
  itemCount: number;
};

/** Cart presentation only; cart review and checkout arrive in later increments. */
export function PosCartButton({ itemCount }: PosCartButtonProps) {
  return (
    <View style={styles.container}>
      <Pressable accessibilityLabel={`Cart, ${itemCount} items`} style={styles.button}>
        <MaterialCommunityIcons color={posDarkColors.onPrimary} name="cart-outline" size={26} />
      </Pressable>
      {itemCount > 0 ? <Badge style={styles.badge}>{itemCount}</Badge> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: posDarkColors.error,
    color: posDarkColors.onPrimary,
    position: 'absolute',
    right: -2,
    top: -4,
  },
  button: {
    alignItems: 'center',
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  container: {
    bottom: 16,
    position: 'absolute',
    right: 16,
  },
});
