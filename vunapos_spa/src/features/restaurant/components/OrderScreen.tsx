import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ReceiptText, Send } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../lib/cn";
import {
  getOrderFromPath,
  getPosPagePath,
  navigateToOrder,
  navigateToPosPage,
  useNavigationStore,
  type POSPage,
} from "../../../lib/stores/navigationStore";
import type { CachedServiceType } from "../../../lib/types";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import type { ItemDTO } from "../../pos/types";
import { formatCurrency } from "../../pos/utils";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useNewOrderDraft } from "../hooks/useNewOrderDraft";
import { useMenu, useMenuFetcher } from "../hooks/useOrderData";
import { useOrderActions } from "../hooks/useOrderActions";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { newId } from "../ids";
import { missingFromMenu } from "../menuConflicts";
import {
  addMenuItem,
  chooseServiceType,
  draftSubtotal,
  hasPendingChanges,
  itemQuantities,
  removeUnsentLines,
  sendBlocker,
  unsentCount,
  type OrderDraft,
} from "../orderDraft";
import { describeOrderError, type OrderErrorView } from "../orderErrors";
import { useOrderDraftStore, type TablePicking } from "../stores/orderDraftStore";
import type { OrderPreviewDTO } from "../types";
import { BillPreviewDialog } from "./BillPreviewDialog";
import { ConflictDialog, type ConflictPrompt } from "./ConflictDialog";
import { MenuPanel } from "./MenuPanel";
import { OrderPanel } from "./OrderPanel";

type Tab = "menu" | "order";

const NEEDS_SERVICE_TYPE = "Choose a service type before sending.";

// Taking an order, menu first: items are added, then the service type (and table)
// chosen. From md up the menu and the order panel sit side by side, the panel
// ending in the totals and actions; phones get Menu / Order tabs and a bottom bar.
// Changes wait on this device until Send (see orderDraft.planSave). After a new
// order is sent the screen resets to the next new order.
export function OrderScreen({ posProfile }: { posProfile?: string }) {
  const bootstrap = useBootstrapData();
  const currency = bootstrap.data?.currency;
  const serviceTypes = useMemo(() => bootstrap.data?.restaurant?.service_types ?? [], [bootstrap.data]);
  const currentPath = useNavigationStore((s) => s.currentPath);
  const orderName = getOrderFromPath(currentPath);
  const draft = useOrderDraftStore((s) => s.draft);
  const setDraft = useOrderDraftStore((s) => s.setDraft);
  const updateDraft = useOrderDraftStore((s) => s.updateDraft);
  const setPicking = useOrderDraftStore((s) => s.setPicking);
  const sendOnArrival = useOrderDraftStore((s) => s.sendOnArrival);
  const setSendOnArrival = useOrderDraftStore((s) => s.setSendOnArrival);
  const setSentNotice = useOrderDraftStore((s) => s.setSentNotice);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const createFresh = useNewOrderDraft();
  const fetchMenu = useMenuFetcher(posProfile);
  const [tab, setTab] = useState<Tab>("menu");
  const [loadError, setLoadError] = useState<OrderErrorView | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<OrderPreviewDTO | null>(null);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);
  const [checkingType, setCheckingType] = useState<string | null>(null);
  const [typeMessage, setTypeMessage] = useState<string | null>(null);

  const menu = useMenu(posProfile, draft?.service_type, draft?.table);
  const { save, load, preview: loadPreview, saving, error, clearError } = useOrderActions({ onMenuChanged: menu.reload });

  // /vunapos/order is a new order (kept while it's being built); /vunapos/order/<name>
  // is a saved one, loaded from the server.
  const needsLoad = Boolean(orderName) && draft?.order?.name !== orderName;
  const needsFresh = !orderName && (!draft || Boolean(draft.order));
  useEffect(() => {
    if (needsFresh) {
      const fresh = createFresh();
      if (fresh) setDraft(fresh);
      return;
    }
    if (!orderName || !needsLoad) return;
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
  }, [createFresh, load, needsFresh, needsLoad, orderName, setDraft]);

  const activeDraft: OrderDraft | null = needsLoad || needsFresh ? null : draft;
  const readOnly = Boolean(activeDraft?.order && activeDraft.order.status !== "Open");
  const dirty = !readOnly && hasPendingChanges(activeDraft);
  const isNew = Boolean(activeDraft && !activeDraft.order);
  // Picking a table keeps the order being built, and "New order" on a new order
  // stays on it; anything else with unsent changes asks first.
  const allowLeave = useCallback(
    (page: POSPage, path: string) =>
      (page === "Floor" && Boolean(useOrderDraftStore.getState().picking)) ||
      (page === "Order" && path === getPosPagePath("Order") && isNew),
    [isNew],
  );
  const guard = useUnsavedChangesGuard(dirty, allowLeave);

  const rates = useMemo(
    () => new Map((menu.menu?.items ?? []).map((item) => [item.item_code, Number(item.rate || 0)])),
    [menu.menu],
  );
  const subtotal = activeDraft ? draftSubtotal(activeDraft, rates) : { amount: 0, unpriced: 0 };
  const waiting = unsentCount(activeDraft);
  const quantities = useMemo(() => itemQuantities(activeDraft), [activeDraft]);

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

  const pickTable = useCallback(
    (then: TablePicking["then"]) => {
      setPicking({ then });
      navigateToPosPage("Floor");
    },
    [setPicking],
  );

  const send = useCallback(async () => {
    const current = useOrderDraftStore.getState().draft;
    if (!current || !hasPendingChanges(current)) return;
    const blocker = sendBlocker(current, serviceTypes);
    if (blocker === "needs-service-type") {
      setTypeMessage(NEEDS_SERVICE_TYPE);
      setTab("order");
      return;
    }
    if (blocker === "needs-table") {
      pickTable("send");
      return;
    }
    const result = await save();
    if (!result.ok) return;
    if (result.created) {
      // Reset to the next new order; the notice links back to the one just sent.
      const created = result.created;
      setSentNotice({ order: created.name, label: created.table_label || created.service_type });
      setDraft(createFresh());
      setTab("menu");
      return;
    }
    showToast({ type: "info", message: "Order sent." });
  }, [createFresh, pickTable, save, serviceTypes, setDraft, setSentNotice, showToast]);

  // Back from the floor after choosing a table for Send, or after adding the lines
  // to an open order: send straight away.
  useEffect(() => {
    if (!sendOnArrival || !activeDraft) return undefined;
    const timer = setTimeout(() => {
      setSendOnArrival(false);
      void send();
    }, 0);
    return () => clearTimeout(timer);
  }, [activeDraft, send, sendOnArrival, setSendOnArrival]);

  const selectServiceType = useCallback(
    async (serviceType: CachedServiceType) => {
      const current = useOrderDraftStore.getState().draft;
      if (!current || current.order || serviceType.name === current.service_type) return;
      setTypeMessage(null);
      clearError();
      if (!current.unsent.length) {
        updateDraft((d) => chooseServiceType(d, serviceType));
        return;
      }
      // Check the lines against the new type's menu first: items it doesn't serve
      // or price would fail on Send.
      const table = chooseServiceType(current, serviceType).table;
      setCheckingType(serviceType.name);
      let candidate;
      try {
        candidate = await fetchMenu(serviceType.name, table);
      } catch (caught) {
        showToast({ type: "error", message: describeOrderError(caught as Error, "The menu could not be loaded.").message });
        return;
      } finally {
        setCheckingType(null);
      }
      const latest = useOrderDraftStore.getState().draft;
      if (!latest || latest.order) return;
      const conflicts = missingFromMenu(latest.unsent, candidate);
      if (!conflicts.length) {
        updateDraft((d) => chooseServiceType(d, serviceType));
        return;
      }
      const previous = serviceTypes.find((row) => row.name === latest.service_type);
      setConflict({
        title: `Not available for ${serviceType.service_type_name}`,
        description: `These items aren't served or priced for ${serviceType.service_type_name}.`,
        lines: conflicts,
        otherLabel: previous ? `Keep ${previous.service_type_name}` : "Cancel",
        onRemove: () =>
          updateDraft((d) =>
            chooseServiceType(
              removeUnsentLines(
                d,
                conflicts.map((line) => line.line_id),
              ),
              serviceType,
            ),
          ),
      });
    },
    [clearError, fetchMenu, serviceTypes, showToast, updateDraft],
  );

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
          <EmptyState title={orderName ? "Loading order" : "Preparing a new order"} description="Just a moment." />
        )}
      </section>
    );
  }

  const canSend = dirty && !saving;
  const canViewBill = Boolean(activeDraft.order) && !dirty && !previewing && Boolean(activeDraft.order?.items.length);
  const sendLabel = saving ? "Sending…" : "Send";

  const totals = (
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-on-surface-variant">Subtotal (before charges)</p>
      <p className="truncate text-base font-semibold tabular-nums text-on-surface">
        {formatCurrency(subtotal.amount, currency)}
        {subtotal.unpriced ? <span className="ml-1 text-xs font-normal text-on-surface-variant">+ {subtotal.unpriced} not priced</span> : null}
      </p>
    </div>
  );
  const actions = (billLabel: ReactNode) => (
    <>
      {activeDraft.order ? (
        <Button
          variant="ghost"
          className="h-11 shrink-0 gap-2"
          disabled={!canViewBill}
          title={dirty ? "Send the waiting changes first" : undefined}
          onClick={() => void viewBill()}
        >
          <ReceiptText className="size-4" aria-hidden="true" />
          {billLabel}
        </Button>
      ) : null}
      {!readOnly ? (
        <Button className="h-11 shrink-0 gap-2" disabled={!canSend} onClick={() => void send()}>
          <Send className="size-4" aria-hidden="true" />
          {sendLabel}
        </Button>
      ) : null}
    </>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col pb-[58px] lg:pb-0">
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2 sm:px-4">
        {activeDraft.order ? (
          <Button
            variant="ghost"
            className="size-10 shrink-0 p-0"
            aria-label="Back to orders"
            onClick={() => navigateToPosPage("Orders")}
          >
            <ArrowLeft className="size-5" />
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-on-surface">
          {activeDraft.order ? (
            <>
              {activeDraft.table_label ? `Table ${activeDraft.table_label}` : activeDraft.service_type}
              <span className="font-normal text-on-surface-variant"> · {activeDraft.order.waiter_name || activeDraft.order.waiter}</span>
            </>
          ) : (
            <>
              New order
              {activeDraft.table_label ? <span className="font-normal text-on-surface-variant"> · Table {activeDraft.table_label}</span> : null}
            </>
          )}
        </h2>
      </div>

      {readOnly ? (
        <p role="status" className="border-b border-outline-variant bg-surface-container px-4 py-2 text-sm text-on-surface">
          This order is {activeDraft.order?.status.toLowerCase()} and can no longer be changed.
        </p>
      ) : null}
      {error ? (
        <ErrorBanner
          error={error}
          onDismiss={clearError}
          onPickTable={isNew ? () => pickTable("return") : undefined}
          onPickServiceType={() => {
            setTypeMessage(NEEDS_SERVICE_TYPE);
            setTab("order");
          }}
        />
      ) : null}

      {/* Phones: one panel at a time. */}
      <div className="flex border-b border-outline-variant md:hidden" role="tablist" aria-label="Order screen">
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

      {/* Explicit columns: an implicit (auto) column would grow to fit unwrapped text. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_clamp(20rem,40vw,30rem)]">
        <div className={cn("min-h-0 min-w-0 flex-col p-3 sm:p-4", tab === "menu" ? "flex" : "hidden md:flex")}>
          <MenuPanel
            menu={menu.menu}
            isLoading={menu.isLoading}
            error={menu.error}
            currency={currency}
            disabled={readOnly || saving}
            quantities={quantities}
            onRetry={menu.reload}
            onAddItem={addItem}
          />
        </div>
        <aside
          className={cn(
            "min-h-0 min-w-0 flex-col border-outline-variant md:border-l",
            tab === "order" ? "flex" : "hidden md:flex",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
            <OrderPanel
              draft={activeDraft}
              rates={rates}
              currency={currency}
              readOnly={readOnly || saving}
              serviceTypes={serviceTypes}
              checkingServiceType={checkingType}
              serviceTypeMessage={typeMessage}
              onChange={updateDraft}
              onSelectServiceType={(serviceType) => void selectServiceType(serviceType)}
              onPickTable={() => pickTable("return")}
            />
          </div>
          {/* Tablet and desktop: totals and actions end the panel. */}
          <div className="hidden items-center gap-2 border-t border-outline-variant bg-surface px-3 py-2 sm:px-4 md:flex">
            {totals}
            {actions(previewing ? "Preparing…" : "View bill")}
          </div>
        </aside>
      </div>

      {/* Phones: totals and actions stay in reach above the bottom nav. */}
      <div className="flex items-center gap-2 border-t border-outline-variant bg-surface px-3 py-2 md:hidden">
        {totals}
        {actions("Bill")}
      </div>

      <BillPreviewDialog preview={preview} currency={currency} onClose={() => setPreview(null)} />
      <ConflictDialog prompt={conflict} onClose={() => setConflict(null)} />
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
  onPickTable,
  onPickServiceType,
}: {
  error: OrderErrorView;
  onDismiss: () => void;
  onPickTable?: () => void;
  onPickServiceType: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-error bg-error-container px-4 py-2 text-sm text-on-error-container">
      <span className="min-w-0 flex-1">{error.message}</span>
      {error.action === "open-order" && error.order ? (
        <Button size="sm" variant="ghost" onClick={() => navigateToOrder(error.order)}>
          Open {error.order}
        </Button>
      ) : null}
      {error.action === "pick-table" && onPickTable ? (
        <Button size="sm" variant="ghost" onClick={onPickTable}>
          Choose another table
        </Button>
      ) : null}
      {error.action === "pick-service-type" ? (
        <Button size="sm" variant="ghost" onClick={onPickServiceType}>
          Choose service type
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
