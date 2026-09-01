import { Redirect } from 'expo-router';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { AppSkeletonScreen } from '@/features/shell/screens/AppSkeletonScreen';

export default function AppIndex() {
  const { authState } = useAppSession();

  if (authState !== 'signedIn') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <AppSkeletonScreen />;
}
