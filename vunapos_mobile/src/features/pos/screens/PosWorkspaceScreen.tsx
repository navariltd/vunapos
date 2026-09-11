import { useCallback, useState } from 'react';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';
import { PosCartScreen } from '@/features/pos/screens/PosCartScreen';
import { PosCheckoutScreen } from '@/features/pos/screens/PosCheckoutScreen';
import { PosCustomerDetailsScreen } from '@/features/pos/screens/PosCustomerDetailsScreen';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';
import { PosInvoicesScreen } from '@/features/pos/screens/PosInvoicesScreen';
import { PosPaymentEntryDetailsScreen } from '@/features/pos/screens/PosPaymentEntryDetailsScreen';
import { PosInvoicePaymentEntry, PosNavigationTab, PosOrderType, PosSaleCustomer } from '@/features/pos/types';
import { usePosCart } from '@/features/pos/hooks/usePosCart';

type SelectedInvoice = {
  doctype?: string;
  name: string;
  returnTo?: { doctype?: string; name: string };
};

/** Owns POS-wide shell state while feature screens remain independent. */
export function PosWorkspaceScreen() {
  const [activeTab, setActiveTab] = useState<PosNavigationTab>('Home');
  const [cartVisible, setCartVisible] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [cartCurrency, setCartCurrency] = useState('KES');
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');
  const [selectedInvoice, setSelectedInvoice] = useState<SelectedInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedPaymentEntry, setSelectedPaymentEntry] = useState<{ currency: string; paymentEntry: PosInvoicePaymentEntry } | null>(null);
  const [saleCustomer, setSaleCustomer] = useState<PosSaleCustomer | null>(null);
  const [posProfile, setPosProfile] = useState<string>();
  const cart = usePosCart({ customer: saleCustomer, posProfile });
  const receivePosProfile = useCallback((profileName: string) => setPosProfile(profileName), []);

  function changeTab(tab: PosNavigationTab) {
    setSelectedInvoice(null);
    setSelectedCustomer(null);
    setSelectedPaymentEntry(null);
    setCartVisible(false);
    setCheckoutVisible(false);
    setActiveTab(tab);
  }

  function startSale(customer: PosSaleCustomer) {
    cart.clear();
    setSaleCustomer(customer);
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setSelectedPaymentEntry(null);
    setCheckoutVisible(false);
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
        : checkoutVisible
        ? <PosCheckoutScreen
            currency={cartCurrency}
            items={cart.items}
            onBack={() => setCheckoutVisible(false)}
            onComplete={(result) => {
              cart.clear();
              setCheckoutVisible(false);
              setCartVisible(false);
              setSelectedInvoice({ doctype: result.doctype, name: result.name });
            }}
            orderType={orderType}
            saleCustomer={saleCustomer}
            subtotal={cart.subtotal}
          />
        : cartVisible
        ? <PosCartScreen
            currency={cartCurrency}
            items={cart.items}
            onBack={() => setCartVisible(false)}
            onCheckout={() => {
              if (!cart.requiresCustomer && !cart.isUpdating && !cart.error) setCheckoutVisible(true);
            }}
            onClear={cart.clear}
            onClearSaleCustomer={() => setSaleCustomer(null)}
            onRemove={cart.remove}
            onSelectSaleCustomer={setSaleCustomer}
            onUpdateQuantity={cart.updateQuantity}
            orderType={orderType}
            requiresCustomer={cart.requiresCustomer}
            saleCustomer={saleCustomer}
            subtotal={cart.subtotal}
            taxes={cart.taxes}
            totals={cart.totals}
            isUpdating={cart.isUpdating}
            error={cart.error}
            onRetry={() => { void cart.retry(); }}
          />
        : activeTab === 'Home'
        ? <PosHomeScreen
            cartItemCount={cart.itemCount}
            onAddToCart={(item, currency) => { setCartCurrency(currency); void cart.add(item); }}
            onOpenCart={() => setCartVisible(true)}
            onPosProfileLoaded={receivePosProfile}
          />
        : <PosInvoicesScreen onBackToPos={() => changeTab('Home')} onOpenInvoice={setSelectedInvoice} />}
    </AppShell>
  );
}
