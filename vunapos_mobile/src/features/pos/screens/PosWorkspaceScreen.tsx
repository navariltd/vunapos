import { useState } from 'react';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';
import { PosCustomerDetailsScreen } from '@/features/pos/screens/PosCustomerDetailsScreen';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';
import { PosInvoicesScreen } from '@/features/pos/screens/PosInvoicesScreen';
import { PosNavigationTab, PosOrderType, PosSaleCustomer } from '@/features/pos/types';

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const [activeTab, setActiveTab] = useState<PosNavigationTab>('Home');
  const [cartItemCount, setCartItemCount] = useState(0);
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');
  const [selectedInvoice, setSelectedInvoice] = useState<{ doctype?: string; name: string } | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [saleCustomer, setSaleCustomer] = useState<PosSaleCustomer | null>(null);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setActiveTab(tab);
  }

  function startSale(customer: PosSaleCustomer) {
    setCartItemCount(0);
    setSaleCustomer(customer);
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setActiveTab('Home');
  }

  return (
    <AppShell activeTab={activeTab} onOrderTypeChange={setOrderType} onTabChange={changeTab} orderType={orderType}>
      {selectedCustomer
        ? <PosCustomerDetailsScreen customer={selectedCustomer} onBack={() => setSelectedCustomer(null)} onStartSale={startSale} />
        : selectedInvoice
        ? <PosInvoiceDetailsScreen invoiceDoctype={selectedInvoice.doctype} invoiceName={selectedInvoice.name} onBack={() => setSelectedInvoice(null)} onOpenCustomer={setSelectedCustomer} onStartSale={startSale} />
        : activeTab === 'Home'
        ? <PosHomeScreen cartItemCount={cartItemCount} onAddToCart={() => setCartItemCount((count) => count + 1)} onClearSaleCustomer={() => setSaleCustomer(null)} saleCustomer={saleCustomer} />
        : <PosInvoicesScreen onBackToPos={() => changeTab('Home')} onOpenInvoice={setSelectedInvoice} />}
    </AppShell>
  );
}
