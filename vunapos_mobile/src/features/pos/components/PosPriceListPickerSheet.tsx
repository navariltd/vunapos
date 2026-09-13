import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { PosPriceList } from '@/features/pos/types';
import { useAppearance } from '@/theme/AppearanceProvider';
import { AppPalette, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  defaultPriceList?: string | null;
  isOffline?: boolean;
  onDismiss: () => void;
  onSelect: (priceList?: string) => void;
  options: PosPriceList[];
  selectedPriceList?: string;
  visible: boolean;
};

/** Restricts choices to price lists supplied by the active POS profile. */
export function PosPriceListPickerSheet({ defaultPriceList, isOffline = false, onDismiss, onSelect, options, selectedPriceList, visible }: Props) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const insets = useSafeAreaInsets();
  const priceLists = [...(defaultPriceList ? [{ name: defaultPriceList }] : []), ...options.filter((option) => option.name !== defaultPriceList)];
  const activePriceList = selectedPriceList || defaultPriceList;

  function select(priceList: string) {
    onSelect(priceList === defaultPriceList ? undefined : priceList);
    onDismiss();
  }

  return <Modal animationType="slide" onRequestClose={onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
    <View style={styles.root}>
      <Pressable accessibilityLabel="Dismiss price list picker" onPress={onDismiss} style={styles.backdrop} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <View style={styles.header}><Text style={styles.title}>Price list</Text><Pressable accessibilityLabel="Close price list picker" onPress={onDismiss} style={styles.closeButton}><Text style={styles.closeButtonLabel}>Close</Text></Pressable></View>
        <Text style={styles.subtitle}>Prices in the cart and catalogue will refresh from the server.</Text>
        {priceLists.map((priceList) => {
          const active = activePriceList === priceList.name;
          return <Pressable accessibilityLabel={`Use price list ${priceList.name}`} disabled={isOffline} key={priceList.name} onPress={() => select(priceList.name)} style={[styles.option, active && styles.optionActive]}><View style={styles.optionContent}><Text style={styles.optionName}>{priceList.name}{priceList.name === defaultPriceList ? ' (Default)' : ''}</Text>{priceList.currency ? <Text style={styles.optionMeta}>{priceList.currency}</Text> : null}</View><Text style={styles.optionCheck}>{active ? '✓' : ''}</Text></Pressable>;
        })}
      </View>
    </View>
  </Modal>;
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  backdrop: { backgroundColor: palette.scrim, ...StyleSheet.absoluteFill },
  closeButton: { borderColor: palette.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  closeButtonLabel: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  handle: { alignSelf: 'center', backgroundColor: palette.border, borderRadius: radii.pill, height: 4, marginBottom: spacing.md, width: 40 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  option: { alignItems: 'center', borderColor: palette.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md },
  optionActive: { borderColor: palette.primary },
  optionCheck: { color: palette.primary, fontFamily: typography.fontFamily.semibold, fontSize: 20, minWidth: 20, textAlign: 'center' },
  optionContent: { flex: 1, gap: 2 },
  optionMeta: { color: palette.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  optionName: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  subtitle: { color: palette.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, marginTop: spacing.sm },
  title: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  });
}
