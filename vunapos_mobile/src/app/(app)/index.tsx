import { Redirect } from 'expo-router';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosWorkspaceScreen } from '@/features/pos/screens/PosWorkspaceScreen';

export default function AppIndex() {
  const { authState } = useAppSession();

  if (authState !== 'signedIn') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <PosWorkspaceScreen />;
}
