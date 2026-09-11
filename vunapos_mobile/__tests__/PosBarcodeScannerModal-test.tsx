import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

const mockRequestPermission = jest.fn();
const mockUseCameraPermissions = jest.fn();

jest.mock('expo-camera', () => ({
  CameraView: (props: object) => require('react').createElement('CameraView', props),
  useCameraPermissions: () => mockUseCameraPermissions(),
}));

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));

import { PosBarcodeScannerModal } from '@/features/pos/components/PosBarcodeScannerModal';

describe('PosBarcodeScannerModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('requests access instead of opening a camera preview when permission is denied', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false }, mockRequestPermission]);
    const screen = await render(<PosBarcodeScannerModal onClose={jest.fn()} onScan={jest.fn()} visible />);

    expect(screen.getByText('Camera access is needed')).toBeTruthy();
    expect(screen.queryByTestId('barcode-camera')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Allow camera access'));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('locks duplicate camera callbacks until an unknown barcode is acknowledged', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, mockRequestPermission]);
    const onScan = jest.fn().mockResolvedValue('No sellable item was found.');
    const screen = await render(<PosBarcodeScannerModal onClose={jest.fn()} onScan={onScan} visible />);
    const camera = screen.getByTestId('barcode-camera');

    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'unknown', type: 'ean13' });
      camera.props.onBarcodeScanned({ data: 'unknown', type: 'ean13' });
    });

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No sellable item was found.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Scan another barcode'));
    await act(async () => {
      screen.getByTestId('barcode-camera').props.onBarcodeScanned({ data: 'next-code', type: 'ean13' });
    });
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it('closes the scanner after a barcode is accepted', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, mockRequestPermission]);
    const onClose = jest.fn();
    const screen = await render(<PosBarcodeScannerModal onClose={onClose} onScan={jest.fn().mockResolvedValue(null)} visible />);

    await act(async () => {
      screen.getByTestId('barcode-camera').props.onBarcodeScanned({ data: '0123456789', type: 'ean13' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
