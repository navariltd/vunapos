Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: require('react-native').ScrollView,
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
