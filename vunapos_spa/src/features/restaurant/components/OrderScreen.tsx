import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ReceiptText, Send } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../lib/cn";
import {
  getOrderFromPath,
  navigateToOrder,
  navigateToPosPage,
  replacePosPage,
  useNavigationStore,
} from "../../../lib/stores/navigationStore";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import type { ItemDTO } from "../../pos/types";
import { formatCurrency } from "../../pos/utils";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useMenu } from "../hooks/useOrderData";
import { useOrderActions } from "../hooks/useOrderActions";
import { useStartOrder } from "../hooks/useStartOrder";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { newId } from "../ids";
import { addMenuItem, draftSubtotal, hasPendingChanges, setContext, unsentCount, type OrderDraft } from "../orderDraft";
import { describeOrderError, type OrderErrorView } from "../orderErrors";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { OrderPreviewDTO } from "../types";
import { BillPreviewDialog } from "./BillPreviewDialog";
import { MenuPanel } from "./MenuPanel";
import { OrderPanel } from "./OrderPanel";
import { ServiceTypePicker } from "./ServiceTypePicker";

type Tab = "menu" | "order";

// Taking an order: the menu on one side, the order on the other (tabs on phones).
// Changes wait on this device until Save / Send (see orderDraft.planSave).
export function OrderScreen({ posProfile }: { posProfile?: string }) {
  const bootstrap = useBootstrapData();
  const currency = bootstrap.data?.currency;
  const currentPath = useNavigationStore((s) => s.currentPath);
  const orderName = getOrderFromPath(currentPath);
  const draft = useOrderDraftStore((s) => s.draft);
  const setDraft = useOrderDraftStore((s) => s.setDraft);
  const updateDraft = useOrderDraftStore((s) => s.updateDraft);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const startOrder = useStartOrder();
  const [tab, setTab] = useState<Tab>("menu");
  const [loadError, setLoadError] = useState<OrderErrorView | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<OrderPreviewDTO | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const menu = useMenu(posProfile, draft?.service_type, draft?.table);
  const { save, load, preview: loadPreview, saving, error, clearError } = useOrderActions({ onMenuChanged: menu.reload });

  // A saved order comes from the server (deep link or reload). A new one exists
  // only in memory: without it, /vunapos/order goes back to the floor.
  const needsLoad = Boolean(orderName) && draft?.order?.name !== orderName;
  useEffect(() => {
    if (!orderName) {
      if (!draft) replacePosPage("Floor");
      else if (draft.order) navigateToOrder(draft.order.name, { replace: true });
      return;
    }
    if (!needsLoad) return;
    let active = true;
    load(orderName)
      .then(() => {
        if (active) setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(describeOrderError(caught as Error, "The order could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [draft, load, needsLoad, orderName]);

  const activeDraft: OrderDraft | null = needsLoad ? null : draft;
  const readOnly = Boolean(activeDraft?.order && activeDraft.order.status !== "Open");
  const dirty = !readOnly && hasPendingChanges(activeDraft);
  const guard = useUnsavedChangesGuard(dirty);

  const rates = useMemo(
    () => new Map((menu.menu?.items ?? []).map((item) => [item.item_code, Number(item.rate || 0)])),
    [menu.menu],
  );
  const subtotal = activeDraft ? draftSubtotal(activeDraft, rates) : { amount: 0, unpriced: 0 };
  const waiting = unsentCount(activeDraft);

  const addItem = useCallback(
    (item: ItemDTO) => {
      if (item.has_variants) {
        showToast({ type: "info", message: "Items with variants can't be ordered yet." });
        return;
      }
      updateDraft((current) => addMenuItem(current, { item_code: item.item_code, item_name: item.item_name, uom: item.uom }, newId));
    },
    [showToast, updateDraft],
  );

  const send = async () => {
    if (await save()) showToast({ type: "info", message: "Order sent." });
  };

  const viewBill = async () => {
    const name = activeDraft?.order?.name;
    if (!name) return;
    setPreviewing(true);
    try {
      setPreview(await loadPreview(name));
    } catch (caught) {
      showToast({ type: "error", message: describeOrderError(caught as Error, "The bill could not be prepared.").message });
    } finally {
      setPreviewing(false);
    }
  };

  const back = () => {
    if (dirty) guard.requestLeave("Floor");
    else navigateToPosPage(activeDraft?.table ? "Floor" : "Orders");
  };

  if (!activeDraft) {
    return (
      <section className="flex h-full items-center justify-center p-4">
        {loadError ? (
          <EmptyState
            title="Order unavailable"
            description={loadError.message}
            action={<Button onClick={() => navigateToPosPage("Orders")}>Back to orders</Button>}
          />
        ) : (
          <EmptyState title="Loading order" description="Fetching the order." />
        )}
      </section>
    );
  }

  const canSend = dirty && !saving;
  const canViewBill = Boolean(activeDraft.order) && !dirty && !previewing && Boolean(activeDraft.order?.items.length);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2 sm:px-4">
        <Button variant="ghost" className="size-10 shrink-0 p-0" aria-label="Back" onClick={back}>
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-on-surface">
          {activeDraft.table_label ? `Table ${activeDraft.table_label}` : activeDraft.service_type}
          {activeDraft.order ? (
            <span className="font-normal text-on-surface-variant"> · {activeDraft.order.waiter_name || activeDraft.order.waiter}</span>
          ) : (
            <span className="font-normal text-on-surface-variant"> · New order</span>
          )}
        </h2>
      </div>

      {readOnly ? (
        <p role="status" className="border-b border-outline-variant bg-surface-container px-4 py-2 text-sm text-on-surface">
          This order is {activeDraft.order?.status.toLowerCase()} and can no longer be changed.
        </p>
      ) : null}
      {error ? <ErrorBanner error={error} onDismiss={clearError} onPickAgain={() => setPickerOpen(true)} /> : null}

      {/* Phones: one panel at a time. */}
      <div className="flex border-b border-outline-variant lg:hidden" role="tablist" aria-label="Order screen">
        {(["menu", "order"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              "h-11 flex-1 text-sm font-medium",
              tab === value ? "border-b-2 border-primary text-on-surface" : "text-on-surface-variant",
            )}
            onClick={() => setTab(value)}
          >
            {value === "menu" ? "Menu" : `Order${waiting ? ` (${waiting} new)` : ""}`}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_clamp(24rem,30vw,30rem)]">
        <div className={cn("min-h-0 flex-col p-3 sm:p-4", tab === "menu" ? "flex" : "hidden lg:flex")}>
          <MenuPanel
            menu={menu.menu}
            isLoading={menu.isLoading}
            error={menu.error}
            currency={currency}
            disabled={readOnly || saving}
            onRetry={menu.reload}
            onAddItem={addItem}
          />
        </div>
        <aside
          className={cn(
            "min-h-0 flex-col border-outline-variant lg:border-l",
            tab === "order" ? "flex" : "hidden lg:flex",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
            <OrderPanel
              draft={activeDraft}
              rates={rates}
              currency={currency}
              readOnly={readOnly || saving}
              onChange={updateDraft}
              onChangeContext={() => setPickerOpen(true)}
            />
          </div>
        </aside>
      </div>

      {/* Totals and actions stay in reach on every screen size. */}
      <div className="flex items-center gap-2 border-t border-outline-variant bg-surface px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] mb-[58px] lg:mb-0 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-on-surface-variant">Subtotal (before charges)</p>
          <p className="text-base font-semibold tabular-nums text-on-surface">
            {formatCurrency(subtotal.amount, currency)}
            {subtotal.unpriced ? <span className="ml-1 text-xs font-normal text-on-surface-variant">+ {subtotal.unpriced} not priced</span> : null}
          </p>
        </div>
        <Button
          variant="ghost"
          className="h-11 shrink-0 gap-2"
          disabled={!canViewBill}
          title={dirty ? "Send the waiting changes first" : undefined}
          onClick={() => void viewBill()}
        >
          <ReceiptText className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{previewing ? "Preparing…" : "View bill"}</span>
          <span className="sm:hidden">Bill</span>
        </Button>
        {!readOnly ? (
          <Button className="h-11 shrink-0 gap-2" disabled={!canSend} onClick={() => void send()}>
            <Send className="size-4" aria-hidden="true" />
            {saving ? "Sending…" : activeDraft.order ? "Send" : "Save / Send"}
          </Button>
        ) : null}
      </div>

      <BillPreviewDialog preview={preview} currency={currency} onClose={() => setPreview(null)} />
      <ServiceTypePicker
        isOpen={pickerOpen}
        serviceTypes={bootstrap.data?.restaurant?.service_types ?? []}
        onClose={() => setPickerOpen(false)}
        onSelect={(serviceType) => {
          setPickerOpen(false);
          // Before the first save the order can switch service type in place, keeping
          // its lines (the server re-checks them against the new menu). A switch that
          // needs a table the order doesn't have goes back to the floor to pick one.
          const current = useOrderDraftStore.getState().draft;
          if (current && !current.order && (!serviceType.requires_table || current.table)) {
            updateDraft((d) =>
              setContext(d, {
                service_type: serviceType.name,
                table: serviceType.requires_table ? d.table : null,
                table_label: serviceType.requires_table ? d.table_label : null,
              }),
            );
            clearError();
            return;
          }
          startOrder(serviceType);
        }}
      />
      <ConfirmDialog
        isOpen={guard.pendingPage !== null}
        danger
        title="Discard changes that weren't sent?"
        description="Lines and edits on this order haven't been sent yet. Leaving now discards them."
        confirmLabel="Discard and leave"
        cancelLabel="Stay"
        onConfirm={() => {
          if (!guard.pendingPage) return;
          // Drop the unsent changes; reopening the order reloads it from the server.
          setDraft(null);
          guard.discardAndLeave(guard.pendingPage);
        }}
        onCancel={guard.stay}
      />
    </section>
  );
}

function ErrorBanner({
  error,
  onDismiss,
  onPickAgain,
}: {
  error: OrderErrorView;
  onDismiss: () => void;
  onPickAgain: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-error bg-error-container px-4 py-2 text-sm text-on-error-container">
      <span className="min-w-0 flex-1">{error.message}</span>
      {error.action === "open-order" && error.order ? (
        <Button size="sm" variant="ghost" onClick={() => navigateToOrder(error.order)}>
          Open {error.order}
        </Button>
      ) : null}
      {error.action === "pick-table" ? (
        <Button size="sm" variant="ghost" onClick={() => navigateToPosPage("Floor")}>
          Choose another table
        </Button>
      ) : null}
      {error.action === "pick-service-type" ? (
        <Button size="sm" variant="ghost" onClick={onPickAgain}>
          Choose service type
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
