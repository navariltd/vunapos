import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({ Text: require('react-native').Text }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

import { PosPriceListPickerSheet } from '@/features/pos/components/PosPriceListPickerSheet';

describe('PosPriceListPickerSheet', () => {
  afterEach(async () => cleanup());

  it('returns to the default list without retaining an explicit override', async () => {
    const onDismiss = jest.fn();
    const onSelect = jest.fn();
    const screen = await render(<PosPriceListPickerSheet defaultPriceList="Retail" onDismiss={onDismiss} onSelect={onSelect} options={[{ name: 'Retail' }, { name: 'Wholesale' }]} selectedPriceList="Wholesale" visible />);

    expect(screen.getByText('Retail (Default)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use price list Retail'));

    expect(onSelect).toHaveBeenCalledWith(undefined);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
