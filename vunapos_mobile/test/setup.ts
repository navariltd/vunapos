Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: require('react-native').ScrollView,
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
