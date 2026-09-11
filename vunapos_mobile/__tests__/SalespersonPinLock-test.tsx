import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

import { SalespersonPinLock } from '@/features/pos/components/SalespersonPinLock';

describe('SalespersonPinLock', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('requires a permitted salesperson and numeric PIN before unlocking the POS', async () => {
    const onVerify = jest.fn().mockResolvedValue(true);
    const screen = await render(
      <SalespersonPinLock
        error={null}
        isVerifying={false}
        onVerify={onVerify}
        pinUsers={[{ display_name: 'Alex Cashier', role: 'Salesperson', sales_person: 'SP-001' }]}
        posProfile="POS-001"
        visible
      />,
    );

    await fireEvent.changeText(screen.getByLabelText('Salesperson PIN'), '12x345');
    expect(screen.getByLabelText('Salesperson PIN').props.value).toBe('12345');
    await fireEvent.press(screen.getByLabelText('Unlock POS'));

    await waitFor(() => expect(onVerify).toHaveBeenCalledWith('SP-001', '12345'));
  });
});
