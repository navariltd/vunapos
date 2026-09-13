import { ComponentProps } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { spacing } from '@/theme/tokens';

type KeyboardAwareFormScrollProps = ComponentProps<typeof KeyboardAwareScrollView>;

/**
 * Shared scroll surface for native forms. It creates enough scroll range when
 * the keyboard is open, then keeps the focused field and its validation state
 * above the keyboard on Android and iOS.
 */
export function KeyboardAwareFormScroll({ bottomOffset = spacing.lg, children, keyboardShouldPersistTaps = 'handled', mode = 'layout', ...props }: KeyboardAwareFormScrollProps) {
  return (
    <KeyboardAwareScrollView
      {...props}
      bottomOffset={bottomOffset}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      mode={mode}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
