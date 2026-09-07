import { useState } from 'react';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';
import { PosCustomerDetailsScreen } from '@/features/pos/screens/PosCustomerDetailsScreen';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';
import { PosInvoicesScreen } from '@/features/pos/screens/PosInvoicesScreen';
import { PosPaymentEntryDetailsScreen } from '@/features/pos/screens/PosPaymentEntryDetailsScreen';
import { PosInvoicePaymentEntry, PosNavigationTab, PosOrderType, PosSaleCustomer } from '@/features/pos/types';

type SelectedInvoice = {
  doctype?: string;
  name: string;
  returnTo?: { doctype?: string; name: string };
};

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const [activeTab, setActiveTab] = useState<PosNavigationTab>('Home');
  const [cartItemCount, setCartItemCount] = useState(0);
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');
  const [selectedInvoice, setSelectedInvoice] = useState<SelectedInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedPaymentEntry, setSelectedPaymentEntry] = useState<{ currency: string; paymentEntry: PosInvoicePaymentEntry } | null>(null);
  const [saleCustomer, setSaleCustomer] = useState<PosSaleCustomer | null>(null);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setSelectedPaymentEntry(null);
    setActiveTab(tab);
  }

  function startSale(customer: PosSaleCustomer) {
    setCartItemCount(0);
    setSaleCustomer(customer);
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setSelectedPaymentEntry(null);
    setActiveTab('Home');
  }

  return (
    <AppShell activeTab={activeTab} onOrderTypeChange={setOrderType} onTabChange={changeTab} orderType={orderType}>
      {selectedPaymentEntry
        ? <PosPaymentEntryDetailsScreen currency={selectedPaymentEntry.currency} onBack={() => setSelectedPaymentEntry(null)} paymentEntry={selectedPaymentEntry.paymentEntry} />
        : selectedCustomer
        ? <PosCustomerDetailsScreen customer={selectedCustomer} onBack={() => setSelectedCustomer(null)} onStartSale={startSale} />
        : selectedInvoice
        ? <PosInvoiceDetailsScreen
            invoiceDoctype={selectedInvoice.doctype}
            invoiceName={selectedInvoice.name}
            onBack={() => setSelectedInvoice(selectedInvoice.returnTo ?? null)}
            onOpenCustomer={setSelectedCustomer}
            onOpenPaymentEntry={(paymentEntry, currency) => setSelectedPaymentEntry({ currency, paymentEntry })}
            onOpenReturn={(invoiceReturn) => setSelectedInvoice({ doctype: selectedInvoice.doctype, name: invoiceReturn.name, returnTo: selectedInvoice })}
            onStartSale={startSale}
          />
        : activeTab === 'Home'
        ? <PosHomeScreen cartItemCount={cartItemCount} onAddToCart={() => setCartItemCount((count) => count + 1)} onClearSaleCustomer={() => setSaleCustomer(null)} saleCustomer={saleCustomer} />
        : <PosInvoicesScreen onBackToPos={() => changeTab('Home')} onOpenInvoice={setSelectedInvoice} />}
    </AppShell>
  );
}
