import { Redirect } from 'expo-router';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';

export default function AppIndex() {
  const { authState } = useAppSession();

  if (authState !== 'signedIn') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <PosHomeScreen />;
}
