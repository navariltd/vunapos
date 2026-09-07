import { useState } from 'react';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';
import { PosInvoicesScreen } from '@/features/pos/screens/PosInvoicesScreen';
import { PosNavigationTab, PosOrderType } from '@/features/pos/types';

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const [activeTab, setActiveTab] = useState<PosNavigationTab>('Home');
  const [cartItemCount, setCartItemCount] = useState(0);
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');
  const [selectedInvoice, setSelectedInvoice] = useState<{ doctype?: string; name: string } | null>(null);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setActiveTab(tab);
  }

  return (
    <AppShell activeTab={activeTab} onOrderTypeChange={setOrderType} onTabChange={changeTab} orderType={orderType}>
      {selectedInvoice
        ? <PosInvoiceDetailsScreen invoiceDoctype={selectedInvoice.doctype} invoiceName={selectedInvoice.name} onBack={() => setSelectedInvoice(null)} />
        : activeTab === 'Home'
        ? <PosHomeScreen cartItemCount={cartItemCount} onAddToCart={() => setCartItemCount((count) => count + 1)} />
        : <PosInvoicesScreen onBackToPos={() => changeTab('Home')} onOpenInvoice={setSelectedInvoice} />}
    </AppShell>
  );
}
