import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
};

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text>{`Redirect:${href}`}</Text>;
  },
  useRouter: () => mockRouter,
}));

jest.mock('@/features/auth/AppSessionProvider', () => ({
  useAppSession: jest.fn(),
}));

jest.mock('@/components/layout/FadeIn', () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('react-native-paper', () => {
  const { Pressable, Text, TextInput: NativeTextInput } = require('react-native');
  const Button = ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress: () => void }) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}><Text>{children}</Text></Pressable>
  );
  const TextInput = ({ label, right, ...props }: { label?: string; right?: React.ReactNode }) => (
    <>
      <NativeTextInput accessibilityLabel={label} {...props} />
      {right}
    </>
  );
  TextInput.Icon = ({ icon, onPress }: { icon: string; onPress: () => void }) => <Pressable accessibilityLabel={icon} accessibilityRole="button" onPress={onPress} />;

  return {
    Button,
    HelperText: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => visible ? <Text>{children}</Text> : null,
    Text,
    TextInput,
  };
});

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { CompanyUrlScreen } from '@/features/auth/screens/CompanyUrlScreen';
import { SignInScreen } from '@/features/auth/screens/SignInScreen';

const mockUseAppSession = jest.mocked(useAppSession);
const saveCompanyUrl = jest.fn();
const signIn = jest.fn();

function setSession(overrides: Record<string, unknown> = {}) {
  mockUseAppSession.mockReturnValue({
    authState: 'signedOut',
    companyUrl: null,
    saveCompanyUrl,
    signIn,
    ...overrides,
  } as unknown as ReturnType<typeof useAppSession>);
}

describe('authentication screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSession();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('CompanyUrlScreen', () => {
    it('keeps Continue disabled until a company URL is entered', async () => {
      const screen = await render(<CompanyUrlScreen />);

      expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState.disabled).toBe(true);
    });

    it('submits a company URL and moves to sign-in after it is verified', async () => {
      saveCompanyUrl.mockResolvedValue({ ok: true });
      const screen = await render(<CompanyUrlScreen />);

      await fireEvent.changeText(screen.getByPlaceholderText('https://yourcompany.example.com'), 'vuna.example.com');
      await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(saveCompanyUrl).toHaveBeenCalledWith('vuna.example.com'));
      expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/sign-in');
    });

    it('disables Continue while company verification is in progress', async () => {
      let resolveSave: (result: { ok: true }) => void;
      saveCompanyUrl.mockReturnValue(new Promise((resolve) => {
        resolveSave = resolve;
      }));
      const screen = await render(<CompanyUrlScreen />);

      await fireEvent.changeText(screen.getByPlaceholderText('https://yourcompany.example.com'), 'vuna.example.com');
      await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

      expect(screen.getByRole('button', { name: 'Checking URL…' }).props.accessibilityState.disabled).toBe(true);
      resolveSave!({ ok: true });
      await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/sign-in'));
    });

    it('keeps the user on the screen and displays a verification failure', async () => {
      saveCompanyUrl.mockResolvedValue({ ok: false, message: 'That address did not respond as a VunaPOS site.' });
      const screen = await render(<CompanyUrlScreen />);

      await fireEvent.changeText(screen.getByPlaceholderText('https://yourcompany.example.com'), 'vuna.example.com');
      await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(screen.getByText('That address did not respond as a VunaPOS site.')).toBeTruthy());
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('prefills the saved company URL when it is being changed', async () => {
      setSession({ companyUrl: 'https://vuna.example.com' });
      const screen = await render(<CompanyUrlScreen />);

      expect(screen.getByDisplayValue('https://vuna.example.com')).toBeTruthy();
    });
  });

  describe('SignInScreen', () => {
    it('redirects to company setup when the device has no company URL', async () => {
      const screen = await render(<SignInScreen />);

      expect(screen.getByText('Redirect:/(auth)/company-url')).toBeTruthy();
    });

    it('validates both credentials before submitting', async () => {
      setSession({ companyUrl: 'https://vuna.example.com' });
      const screen = await render(<SignInScreen />);

      await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

      expect(screen.getByText('Enter your sign-in ID.')).toBeTruthy();
      expect(screen.getByText('Enter your password.')).toBeTruthy();
      expect(signIn).not.toHaveBeenCalled();
    });

    it('signs in with the entered credentials and opens the POS workspace', async () => {
      setSession({ companyUrl: 'https://vuna.example.com' });
      signIn.mockResolvedValue({ ok: true });
      const screen = await render(<SignInScreen />);

      await fireEvent.changeText(screen.getByPlaceholderText('Enter your sign-in ID'), 'cashier@example.com');
      await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
      await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => expect(signIn).toHaveBeenCalledWith('cashier@example.com', 'secret'));
      expect(mockRouter.replace).toHaveBeenCalledWith('/(app)');
    });

    it('toggles password visibility without changing the entered password', async () => {
      setSession({ companyUrl: 'https://vuna.example.com' });
      const screen = await render(<SignInScreen />);

      await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
      await fireEvent.press(screen.getByLabelText('eye-outline'));

      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
      expect(screen.getByLabelText('Password').props.value).toBe('secret');
    });

    it('shows sign-in and expired-session errors and allows changing the company URL', async () => {
      setSession({ authState: 'sessionExpired', companyUrl: 'https://vuna.example.com' });
      signIn.mockResolvedValue({ ok: false, message: 'Sign-in failed. Check your details and try again.' });
      const screen = await render(<SignInScreen />);

      expect(screen.getByText('Your session has expired. Sign in again to continue.')).toBeTruthy();
      await fireEvent.changeText(screen.getByPlaceholderText('Enter your sign-in ID'), 'cashier');
      await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong-password');
      await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => expect(screen.getByText('Sign-in failed. Check your details and try again.')).toBeTruthy());
      await fireEvent.press(screen.getByRole('button', { name: 'Change company URL' }));
      expect(mockRouter.push).toHaveBeenCalledWith('/(auth)/company-url');
    });
  });
});
