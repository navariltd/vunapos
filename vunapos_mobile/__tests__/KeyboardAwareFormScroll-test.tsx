import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { spacing } from '@/theme/tokens';

describe('KeyboardAwareFormScroll', () => {
  it('uses layout mode, preserves taps, and keeps space below a focused field', async () => {
    const screen = await render(
      <KeyboardAwareFormScroll testID="keyboard-aware-form">
        <Text>Form field</Text>
      </KeyboardAwareFormScroll>,
    );

    const form = screen.getByTestId('keyboard-aware-form');
    expect(form.props.bottomOffset).toBe(spacing.lg);
    expect(form.props.keyboardShouldPersistTaps).toBe('handled');
    expect(form.props.mode).toBe('layout');
  });
});
