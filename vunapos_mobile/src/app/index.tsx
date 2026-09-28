import { Redirect } from 'expo-router';

import { useAppSession } from '@/features/auth/AppSessionProvider';

export default function Index() {
  const { authState } = useAppSession();

  if (authState === 'needsCompanyUrl') {
    return <Redirect href="/(auth)/company-url" />;
  }

  return <Redirect href={authState === 'signedIn' ? '/(app)' : '/(auth)/sign-in'} />;
}
