import { Redirect } from 'expo-router';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosWorkspaceScreen } from '@/features/pos/screens/PosWorkspaceScreen';
import { posWorkspaceScopeKey, useRootPosBootstrapSnapshot } from '@/sync/PosBootstrapSnapshot';

export default function AppIndex() {
  const { authState } = useAppSession();
  const snapshot = useRootPosBootstrapSnapshot();

  if (authState !== 'signedIn') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // A genuine POS Profile switch must not carry the previous profile's local
  // cart/checkout state into a newly authorized warehouse or company scope.
  return <PosWorkspaceScreen key={posWorkspaceScopeKey(snapshot?.data) ?? 'workspace'} />;
}
