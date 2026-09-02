import { useState } from 'react';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';
import { PosInvoicesScreen } from '@/features/pos/screens/PosInvoicesScreen';
import { PosNavigationTab, PosOrderType } from '@/features/pos/types';

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const [activeTab, setActiveTab] = useState<PosNavigationTab>('Home');
  const [cartItemCount, setCartItemCount] = useState(0);
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');

  return (
    <AppShell activeTab={activeTab} onOrderTypeChange={setOrderType} onTabChange={setActiveTab} orderType={orderType}>
      {activeTab === 'Home'
        ? <PosHomeScreen cartItemCount={cartItemCount} onAddToCart={() => setCartItemCount((count) => count + 1)} />
        : <PosInvoicesScreen />}
    </AppShell>
  );
}
