import { useFrappeGetCall } from "frappe-react-sdk";

import {
  getCustomerFromPath,
  getInvoiceDoctypeFromPath,
  getInvoiceFromPath,
  navigateToPosPage,
} from "../../../lib/stores/navigationStore";
import { useConnectivityStore } from "../../../lib/stores/connectivityStore";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import { CustomerDetailsPage } from "../../customers/CustomerDetailsPage";
import { CustomersPage } from "../../customers/CustomersPage";
import { PaymentsPage } from "../../payments/PaymentsPage";
import { InvoiceDetailsPage } from "../../pos/components/InvoiceDetailsPage";
import { InvoicesPage } from "../../pos/components/InvoicesPage";
import type {
  BootstrapData,
  CustomerDTO,
  HeldInvoiceDTO,
} from "../../pos/types";
import type { POSPage } from "../../../lib/stores/navigationStore";
import { newId } from "../ids";
import { newOrderDraft } from "../orderDraft";
import { useOrderDraftStore } from "../stores/orderDraftStore";

// Reuse the shared pages, without mounting the retail selling controller and
// starting its cart initialization, repricing and polling in restaurant mode.
export function SharedRestaurantPages({
  page,
  path,
  bootstrap,
}: {
  page: POSPage;
  path: string;
  bootstrap: BootstrapData;
}) {
  const reachable = useConnectivityStore((s) => s.state === "reachable");
  const paymentModes =
    bootstrap.modes_of_payment || bootstrap.mode_of_payments || [];
  const startSale = (customer: CustomerDTO) => {
    const current = useOrderDraftStore.getState().draft;
    if (
      current?.unsent.length &&
      !window.confirm("Start a new sale and discard the current unsent items?")
    )
      return;
    const services = bootstrap.restaurant?.service_types || [];
    const service = services.find((row) => row.is_default) || services[0];
    if (!service || !bootstrap.pos_profile) return;
    useOrderDraftStore.getState().setDraft(
      newOrderDraft({
        pos_profile: bootstrap.pos_profile,
        service_type: service.name,
        customer: customer.customer,
        customer_name: customer.customer_name,
        idempotency_key: newId(),
      })
    );
    navigateToPosPage("Home");
  };

  if (page === "Invoices") {
    const invoice = getInvoiceFromPath(path);
    return invoice ? (
      <InvoiceDetailsPage
        invoice={invoice}
        invoiceDoctype={getInvoiceDoctypeFromPath(path)}
        posProfile={bootstrap.pos_profile}
        allowReturns={bootstrap.allow_returns !== false}
        isOnline={reachable && navigator.onLine !== false}
        onStartSale={startSale}
      />
    ) : (
      <RestaurantSalesHistory bootstrap={bootstrap} />
    );
  }
  if (page === "Payments")
    return (
      <PaymentsPage
        posProfile={bootstrap.pos_profile}
        currency={bootstrap.currency}
        paymentModes={paymentModes}
        allowHistory={bootstrap.allow_payment_history !== false}
        allowReceive={Boolean(bootstrap.can_take_payment) && bootstrap.allow_customer_payments !== false}
        allowReconciliation={Boolean(bootstrap.can_take_payment) && bootstrap.allow_payment_reconciliation !== false}
        isOnline={reachable && navigator.onLine !== false}
      />
    );
  const customer = getCustomerFromPath(path);
  return customer ? (
    <CustomerDetailsPage
      customer={customer}
      posProfile={bootstrap.pos_profile}
      onStartSale={startSale}
    />
  ) : (
    <CustomersPage
      posProfile={bootstrap.pos_profile}
      defaultCurrency={bootstrap.currency}
    />
  );
}

function RestaurantSalesHistory({ bootstrap }: { bootstrap: BootstrapData }) {
  const held = useFrappeGetCall<unknown>(
    vunaMethods.listHeldInvoices,
    { pos_profile: bootstrap.pos_profile },
    bootstrap.pos_profile
      ? ["restaurant-held-invoices", bootstrap.pos_profile]
      : null
  );
  let invoices: HeldInvoiceDTO[] = [];
  let error: string | undefined = held.error?.message;
  try {
    if (held.data) invoices = unwrapVunaResponse<HeldInvoiceDTO[]>(held.data);
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Unable to load draft invoices";
  }
  return (
    <>
      {error ? (
        <p role="alert" className="p-4 text-sm text-error">
          {error}
        </p>
      ) : null}
      <InvoicesPage
        posProfile={bootstrap.pos_profile}
        currency={bootstrap.currency}
        paymentModes={
          bootstrap.modes_of_payment || bootstrap.mode_of_payments || []
        }
        heldInvoices={invoices}
        heldLoading={held.isLoading}
        currentShiftAvailable={Boolean(bootstrap.can_take_payment)}
        onBack={() => navigateToPosPage("Home")}
      />
    </>
  );
}
