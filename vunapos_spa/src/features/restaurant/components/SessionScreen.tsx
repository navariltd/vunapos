import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { CartPanel } from "../../pos/components/CartPanel";
import { SellingWorkspace } from "../../pos/components/SellingWorkspace";
import type { CatalogueView } from "../../pos/components/ItemSearch";
import { BarcodeScannerDialog } from "../../pos/components/BarcodeScannerDialog";
import {
  VariantPickerDialog,
  type TemplateVariant,
} from "../../pos/components/VariantPickerDialog";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToRestaurantSession } from "../../../lib/stores/navigationStore";
import {
  createSessionRound,
  validateRestaurantCart,
  getRestaurantSession,
  openRestaurantSession,
  updateRestaurantSession,
  cancelEmptyRestaurantSession,
  VunaApiError,
  getTemplateVariants,
  vunaMethods,
} from "../../../services/vunaApi";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { formatCurrency, normalizeDefaultCustomer } from "../../pos/utils";
import type { ItemDTO, CustomerDTO, InvoiceDTO } from "../../pos/types";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useFloorPlan } from "../hooks/useFloorPlan";
import { useMenu, useTableStatus } from "../hooks/useOrderData";
import { usePolledData } from "../hooks/usePolledData";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { newId } from "../ids";
import { tableSelectionRequired } from "../tableContext";
import {
  addMenuItem,
  effectiveHeader,
  newOrderDraft,
  planSave,
  removeUnsent,
  setContext,
  setHeader,
  type OrderDraft,
} from "../orderDraft";
import { committedSessionTotal, newSessionRound } from "../sessionDraft";
import { useRestaurantPricing } from "../hooks/useRestaurantPricing";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import { Sheet } from "./Sheet";
import { TablePlanPicker } from "./TablePlanPicker";
import { ModifierPicker } from "./ModifierPicker";
import { KitchenRoutingPicker } from "./KitchenRoutingPicker";
import { KitchenTicketSheet } from "./KitchenTicketSheet";
import { SessionBill } from "./SessionBill";
import { parseKitchenRoutingIssue } from "../kitchenRouting";
import { ValidatedDraftQueue } from "../validatedDraftQueue";
import { kitchenStatusClass } from "../kitchenStatus";
import type { KitchenRoutingIssue } from "../types";
import type {
  ModifierGroupDTO,
  SelectedModifier,
  RestaurantSessionDTO,
} from "../types";

/** Restaurant workflow controller around the SAME selling workspace and cart used by retail. */
export function SessionScreen({
  sessionName,
  posProfile,
}: {
  sessionName?: string | null;
  posProfile?: string;
}) {
  const bootstrap = useBootstrapData();
  // Opening a visit and sending a round are separate requests. Keep a newly
  // opened visit authoritative even when routing/round submission needs a retry.
  const [openedSession, setOpenedSession] =
    useState<RestaurantSessionDTO | null>(null);
  const effectiveSessionName = sessionName || openedSession?.name;
  const getCall = useFrappePostCall(vunaMethods.getRestaurantSession);
  const openCall = useFrappePostCall(vunaMethods.openRestaurantSession);
  const roundCall = useFrappePostCall(vunaMethods.createSessionRound);
  const updateCall = useFrappePostCall(vunaMethods.updateRestaurantSession);
  const cancelCall = useFrappePostCall(
    vunaMethods.cancelEmptyRestaurantSession
  );
  const variantsCall = useFrappePostCall(vunaMethods.getTemplateVariants);
  const stockCall = useFrappePostCall(vunaMethods.validateRestaurantCart);
  const fetcher = useCallback(
    () => getRestaurantSession(getCall.call, effectiveSessionName || ""),
    [getCall.call, effectiveSessionName]
  );
  const result = usePolledData(
    effectiveSessionName ? `session:${effectiveSessionName}` : null,
    fetcher
  );
  const session = result.data || openedSession;
  const draft = useOrderDraftStore((s) => s.draft);
  const setDraft = useOrderDraftStore((s) => s.setDraft);
  const updateDraft = useOrderDraftStore((s) => s.updateDraft);
  const markChanged = useOrderDraftStore((s) => s.markOrdersChanged);
  const serviceTypes = bootstrap.data?.restaurant?.service_types;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<CatalogueView>(() =>
    window.localStorage.getItem("vunapos.catalogue-view") === "list"
      ? "list"
      : "grid"
  );
  const [tablePicker, setTablePicker] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [guestEdit, setGuestEdit] = useState<string | null>(null);
  const [template, setTemplate] = useState<ItemDTO | null>(null);
  const variantRequest = useRef(0);
  const [variants, setVariants] = useState<TemplateVariant[]>([]);
  const [error, setErrorState] = useState<string | null>(null);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const setError = useCallback(
    (message: string | null) => {
      setErrorState(message);
      if (message) showToast({ type: "error", message });
    },
    [showToast]
  );
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(false);
  const cartQueue = useRef(new ValidatedDraftQueue<OrderDraft>());
  const cartEditEpoch = useRef(0);
  const [checkingCart, setCheckingCart] = useState(false);
  const [pendingCart, setPendingCart] = useState<{
    source: OrderDraft | null;
    candidate: OrderDraft;
  } | null>(null);
  const pendingCartEdit = useRef<((current: OrderDraft) => OrderDraft) | null>(
    null
  );
  const activeDraft = sessionName
    ? draft?.restaurant_session === sessionName
      ? draft
      : null
    : draft && !draft.order && !draft.restaurant_session
    ? draft
    : null;
  const header = activeDraft ? effectiveHeader(activeDraft) : null;
  const type = serviceTypes?.find(
    (row) => row.name === (session?.service_type || activeDraft?.service_type)
  );
  const needsTable = tableSelectionRequired(
    type?.requires_table,
    activeDraft?.table
  );
  const menu = useMenu(
    posProfile,
    type?.name,
    activeDraft?.table,
    session?.customer || header?.customer,
    session?.selling_price_list,
    !needsTable
  );
  const floor = useFloorPlan(posProfile);
  const status = useTableStatus(posProfile);
  const currency = session?.currency || bootstrap.data?.currency;
  const guard = useUnsavedChangesGuard(
    Boolean(activeDraft?.unsent.length) || busy
  );

  useEffect(() => {
    if (sessionName) {
      if (session && !activeDraft) setDraft(newSessionRound(session, newId()));
    } else if (!activeDraft && posProfile && serviceTypes?.length) {
      const service =
        serviceTypes.find((row) => row.is_default) || serviceTypes[0];
      const customer = normalizeDefaultCustomer(bootstrap.data);
      setDraft(
        newOrderDraft({
          pos_profile: posProfile,
          service_type: service.name,
          customer: customer?.customer,
          customer_name: customer?.customer_name,
          idempotency_key: newId(),
        })
      );
    }
  }, [
    sessionName,
    session,
    activeDraft,
    posProfile,
    serviceTypes,
    bootstrap.data,
    setDraft,
  ]);

  const [knownItems, setKnownItems] = useState<ItemDTO[]>([]);
  const [routingIssue, setRoutingIssue] = useState<KitchenRoutingIssue | null>(
    null
  );
  const [ticketName, setTicketName] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState<{
    item: ItemDTO;
    groups: ModifierGroupDTO[];
    lineId?: string;
  } | null>(null);
  const catalogue = useMemo(
    () => [...(menu.menu?.items || []), ...knownItems],
    [menu.menu, knownItems]
  );
  const visibleDraft =
    activeDraft && pendingCart?.source === activeDraft
      ? pendingCart.candidate
      : activeDraft;
  const pricing = useRestaurantPricing(
    visibleDraft,
    catalogue,
    menu.menu,
    bootstrap.data,
    session?.selling_price_list,
    setError,
    visibleDraft !== activeDraft || needsTable
  );
  const invoice = pricing.invoice;
  const checkedPrices = useRef(new WeakMap<OrderDraft, InvoiceDTO>());
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (menu.menu?.items || []).filter(
      (item) =>
        (!category || item.menu_category === category) &&
        (!needle ||
          `${item.item_code} ${item.item_name} ${item.barcode || ""}`
            .toLowerCase()
            .includes(needle))
    );
  }, [menu.menu, category, query]);

  // Validate the entire candidate round, not just the clicked item's recipe:
  // different items/UOMs can consume the same last ingredient.
  const checkedEdit = (edit: (current: OrderDraft) => OrderDraft) => {
    setError(null);
    const epoch = cartEditEpoch.current;
    let pendingCandidate: OrderDraft | null = null;
    return cartQueue.current
      .enqueue({
        read: () => useOrderDraftStore.getState().draft,
        commit: (next) => {
          setDraft(next);
          const preview = checkedPrices.current.get(next);
          if (preview) pricing.accept(next, preview);
        },
        edit,
        blocked: () =>
          inFlight.current ||
          epoch !== cartEditEpoch.current ||
          useOrderDraftStore.getState().draft?.service_type !==
            activeDraft?.service_type ||
          useOrderDraftStore.getState().draft?.table !== activeDraft?.table ||
          useOrderDraftStore.getState().draft?.idempotency_key !==
            activeDraft?.idempotency_key,
        changed: (count) => setCheckingCart(count > 0),
        validate: async (next) => {
          pendingCandidate = next;
          setPendingCart({
            source: useOrderDraftStore.getState().draft,
            candidate: next,
          });
          const step = planSave(next)[0];
          if (step?.kind === "create" && step.params.items.length) {
            const checked = await validateRestaurantCart(stockCall.call, {
              pos_profile: next.pos_profile,
              service_type: next.service_type,
              table: next.table,
              customer: effectiveHeader(next).customer,
              items: step.params.items,
              kitchen_routing: next.kitchen_routing,
              price_list: session?.selling_price_list,
            });
            checkedPrices.current.set(next, checked.invoice);
          }
        },
      })
      .catch((caught: unknown) => {
        if (
          caught instanceof VunaApiError &&
          ["KITCHEN_ROUTING_REQUIRED", "INVALID_KITCHEN_STATION"].includes(
            caught.code || ""
          )
        ) {
          pendingCartEdit.current = edit;
          setRoutingIssue(parseKitchenRoutingIssue(caught.meta));
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to check ingredient stock."
        );
        throw caught;
      })
      .finally(() =>
        setPendingCart((current) =>
          current?.candidate === pendingCandidate ? null : current
        )
      );
  };

  const addItem = async (item: ItemDTO, modifiers?: SelectedModifier[]) => {
    if (busy || (session && session.status !== "Open")) return;
    if (needsTable) {
      setTablePicker(true);
      return;
    }
    setError(null);
    if (item.has_variants) {
      const request = ++variantRequest.current;
      setTemplate(item);
      setVariants([]);
      try {
        const response = await getTemplateVariants(variantsCall.call, {
          template_item_code: item.item_code,
          pos_profile: posProfile,
          customer: header?.customer || undefined,
          price_list: session?.selling_price_list || undefined,
        });
        if (request === variantRequest.current)
          setVariants(
            response.variants.filter(
              (row) =>
                !menu.menu?.available_item_codes ||
                menu.menu.available_item_codes.includes(row.item_code)
            )
          );
      } catch (caught) {
        if (request === variantRequest.current)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load variants."
          );
      }
      return;
    }
    const groups =
      menu.menu?.modifier_groups?.[item.item_code] ||
      menu.menu?.modifier_groups?.[item.variant_of || ""] ||
      [];
    if (modifiers === undefined && groups.length) {
      setCustomizing({ item, groups });
      return;
    }
    setKnownItems((current) => [
      ...current.filter((row) => row.item_code !== item.item_code),
      item,
    ]);
    setPending(item.item_code);
    try {
      await checkedEdit((current) => {
        const next = addMenuItem(
          current,
          {
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            modifiers,
          },
          newId
        );
        if (
          bootstrap.data?.new_item_position === "Top" &&
          next.unsent.length > current.unsent.length
        )
          return {
            ...next,
            unsent: [
              next.unsent[next.unsent.length - 1],
              ...next.unsent.slice(0, -1),
            ],
          };
        return next;
      });
    } catch {
      /* checkedEdit displays the server's actionable error. */
    }
    window.setTimeout(
      () => setPending((value) => (value === item.item_code ? null : value)),
      100
    );
  };

  const scan = (value: string) => {
    if (needsTable) {
      setTablePicker(true);
      return;
    }
    const item = menu.menu?.items.find(
      (row) => row.item_code === value || row.barcode === value
    );
    if (item) void addItem(item);
    else setQuery(value);
  };

  const send = async (kitchenRouting?: Record<string, string>) => {
    if (
      !activeDraft ||
      inFlight.current ||
      cartQueue.current.pending ||
      !posProfile
    )
      return;
    pendingCartEdit.current = null;
    if (needsTable) {
      setTablePicker(true);
      return;
    }
    const step = planSave(activeDraft)[0];
    if (!step || step.kind !== "create") return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const visit =
        session ||
        (await openRestaurantSession(openCall.call, {
          pos_profile: posProfile,
          idempotency_key: `session:${activeDraft.idempotency_key}`,
          service_type: activeDraft.service_type,
          tables: activeDraft.table ? [activeDraft.table] : [],
          customer: header?.customer || null,
          guest_count: header?.pax || 0,
        }));
      if (!sessionName) setOpenedSession(visit);
      await createSessionRound(roundCall.call, {
        session: visit.name,
        items: step.params.items,
        idempotency_key: activeDraft.idempotency_key,
        order_note: step.params.order_note,
        pos_profile: posProfile,
        kitchen_routing: kitchenRouting || activeDraft.kitchen_routing,
      });
      setDraft(newSessionRound(visit, newId()));
      markChanged();
      if (!sessionName)
        navigateToRestaurantSession(visit.name, { replace: true });
      else await result.refresh();
    } catch (caught) {
      if (
        caught instanceof VunaApiError &&
        ["KITCHEN_ROUTING_REQUIRED", "INVALID_KITCHEN_STATION"].includes(
          caught.code || ""
        )
      )
        setRoutingIssue(parseKitchenRoutingIssue(caught.meta));
      if (
        caught instanceof VunaApiError &&
        [
          "INVALID_MODIFIERS",
          "MENU_ITEM_NOT_AVAILABLE",
          "ADDON_PRICE_REQUIRED",
        ].includes(caught.code || "")
      )
        menu.reload();
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to place this order. You can retry safely."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const pickTable = async (table: { name: string; table_label: string }) => {
    if (!status.data || !activeDraft) return;
    const occupied = status.data.find((row) => row.table === table.name);
    if (occupied?.session && occupied.session.name !== sessionName) {
      if (session) {
        setError(
          "That table belongs to another session. Choose a free table to join."
        );
        return;
      }
      if (activeDraft.unsent.length) {
        setError(
          "Clear or place your current order before opening another table's session."
        );
        return;
      }
      setTablePicker(false);
      navigateToRestaurantSession(occupied.session.name);
      return;
    }
    if (occupied?.orders.length) {
      setError(
        "This table has a legacy order. Open it from Orders before starting another session."
      );
      return;
    }
    if (session) {
      setSelectedTables((previous) =>
        previous.includes(table.name)
          ? previous.filter((name) => name !== table.name)
          : [...previous, table.name]
      );
    } else {
      try {
        await checkedEdit((current) =>
          setContext(current, {
            service_type: current.service_type,
            table: table.name,
            table_label: table.table_label,
          })
        );
      } catch {
        return;
      }
      setTablePicker(false);
      setCartOpen(false);
    }
  };

  const selectCustomer = async (customer: CustomerDTO | null) => {
    const selected = customer || normalizeDefaultCustomer(bootstrap.data);
    if (session) {
      if (!selected || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await updateRestaurantSession(updateCall.call, {
          session: session.name,
          customer: selected.customer,
        });
        updateDraft((current) =>
          setHeader(current, {
            customer: selected.customer,
            customer_name: selected.customer_name,
          })
        );
        markChanged();
        await result.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to change customer."
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    } else
      updateDraft((current) =>
        setHeader(current, {
          customer: selected?.customer || null,
          customer_name: selected?.customer_name || null,
        })
      );
  };

  if (bootstrap.data && !serviceTypes?.length)
    return (
      <EmptyState
        title="No service types configured"
        description="Add a service type to this Restaurant before taking orders."
      />
    );
  if (!activeDraft || !invoice || (sessionName && !session))
    return (
      <EmptyState
        title={result.error ? "Session unavailable" : "Loading POS"}
        description={result.error || "Preparing the selling screen."}
        action={
          result.error ? (
            <Button onClick={() => void result.refresh()}>Retry</Button>
          ) : undefined
        }
      />
    );
  const readOnly =
    busy || checkingCart || Boolean(session && session.status !== "Open");
  const context = (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2" aria-label="Service type">
        {serviceTypes?.map((service) => (
          <button
            key={service.name}
            type="button"
            aria-pressed={type?.name === service.name}
            disabled={busy || Boolean(session && service.name !== type?.name)}
            className={`h-10 cursor-pointer rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${
              type?.name === service.name
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-low"
            }`}
            onClick={() => {
              updateDraft((current) =>
                setContext(current, {
                  service_type: service.name,
                  table: service.requires_table ? current.table : null,
                  table_label: service.requires_table
                    ? current.table_label
                    : null,
                })
              );
              setCategory("");
              if (service.requires_table) {
                setSelectedTables(
                  session?.tables
                    .filter((row) => !row.released_at)
                    .map((row) => row.table) || []
                );
                setTablePicker(true);
              } else setCartOpen(false);
            }}
          >
            {service.service_type_name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {type?.requires_table ? (
          <Button
            variant="ghost"
            disabled={readOnly}
            onClick={() => {
              setSelectedTables(
                session?.tables
                  .filter((row) => !row.released_at)
                  .map((row) => row.table) || []
              );
              setTablePicker(true);
            }}
          >
            {session
              ? session.tables
                  .filter((row) => !row.released_at)
                  .map((row) => `Table ${row.table_label}`)
                  .join(" + ")
              : activeDraft.table_label
              ? `Table ${activeDraft.table_label}`
              : "Select table"}
          </Button>
        ) : null}
        <label>
          Guests{" "}
          <input
            aria-label="Guests"
            className="ml-1 w-16 rounded-md border border-outline-variant bg-surface px-2 py-1"
            type="number"
            min={0}
            disabled={readOnly}
            value={guestEdit ?? session?.guest_count ?? header?.pax ?? 0}
            onChange={(event) => {
              if (!session)
                updateDraft((current) =>
                  setHeader(current, {
                    pax: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0)
                    ),
                  })
                );
              else setGuestEdit(event.target.value);
            }}
            onBlur={() => {
              if (session && guestEdit !== null) {
                const value = Math.max(0, Math.floor(Number(guestEdit) || 0));
                void updateRestaurantSession(updateCall.call, {
                  session: session.name,
                  guest_count: value,
                })
                  .then(async () => {
                    markChanged();
                    await result.refresh();
                    setGuestEdit(null);
                  })
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "Unable to update guests."
                    )
                  );
              }
            }}
          />
        </label>
        {session ? (
          <Button variant="ghost" onClick={() => setRoundsOpen(true)}>
            View orders ({session.rounds.length})
          </Button>
        ) : null}
        {session && posProfile ? (
          <SessionBill
            session={session}
            posProfile={posProfile}
            unsent={Boolean(activeDraft.unsent.length)}
            onChanged={() => void result.refresh()}
          />
        ) : null}
        {session?.preparation_status &&
        session.preparation_status !== "No preparation" ? (
          <span
            title="Preparation across stations you can access"
            className={`rounded-full px-2 py-1 text-xs font-semibold ${kitchenStatusClass(
              session.preparation_status
            )}`}
          >
            Kitchen: {session.preparation_status}
          </span>
        ) : null}
      </div>
      {menu.error ? (
        <p
          role="alert"
          className="rounded bg-error-container p-2 text-xs text-on-error-container"
        >
          {menu.error}
        </p>
      ) : null}
    </div>
  );
  const renderCart = (className: string) => (
    <CartPanel
      className={className}
      presentation={{
        invoice,
        customer: header?.customer
          ? {
              customer: header.customer,
              customer_name: header.customer_name || header.customer,
            }
          : null,
        isMutating: readOnly,
      }}
      beforeCustomer={context}
      renderItemFooter={(id) => {
        const line = activeDraft.unsent.find((row) => row.line_id === id);
        const item = [...(menu.menu?.items || []), ...knownItems].find(
          (row) => row.item_code === line?.item_code
        );
        const groups =
          item &&
          (menu.menu?.modifier_groups?.[item.item_code] ||
            menu.menu?.modifier_groups?.[item.variant_of || ""]);
        if (!line || !item || (!groups?.length && !line.modifiers?.length))
          return null;
        return (
          <button
            type="button"
            disabled={readOnly}
            className="w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs text-primary hover:bg-surface-container-low"
            onClick={() =>
              setCustomizing({ item, groups: groups || [], lineId: id })
            }
          >
            {line.modifiers?.length
              ? line.modifiers.map((choice) => choice.label).join(" · ")
              : "Customize options"}{" "}
            · Edit
          </button>
        );
      }}
      customerDisabled={Boolean(session?.rounds.length) || readOnly}
      primaryActionLabel={busy ? "Placing order…" : "Place Order"}
      hideHold
      totalsNote="Current order totals. Prices and taxes are recalculated when the order is placed."
      currency={currency}
      posProfile={posProfile}
      isOnline={navigator.onLine}
      allowCustomerCreation={false}
      allowRateChange={false}
      allowDiscountChange={false}
      onSelectCustomer={(customer) => void selectCustomer(customer)}
      onClearCustomer={() => void selectCustomer(null)}
      onCheckout={() => void send()}
      onClearCart={() => setClearConfirm(true)}
      onHold={() => {}}
      onSelectPriceList={() => {}}
      onSelectShippingAddress={() => {}}
      onRemoveItem={(id) => {
        cartEditEpoch.current++;
        updateDraft((current) => removeUnsent(current, id));
      }}
      onUpdateQty={async (id, qty) => {
        await checkedEdit((current) => ({
          ...current,
          unsent: current.unsent.map((row) =>
            row.line_id === id ? { ...row, qty } : row
          ),
        }));
      }}
      onUpdateNote={async (id, note) => {
        updateDraft((current) => ({
          ...current,
          unsent: current.unsent.map((row) =>
            row.line_id === id ? { ...row, note } : row
          ),
        }));
      }}
      onUpdateUom={async (id, uom) => {
        await checkedEdit((current) => ({
          ...current,
          unsent: current.unsent.map((row) =>
            row.line_id === id ? { ...row, uom } : row
          ),
        }));
      }}
      onUpdatePricing={async () => {}}
      onUpdateBatchAllocations={async () => {}}
      onUpdateSerialAllocations={async () => {}}
      onLoadBatches={async (item_code) => ({ item_code, batches: [] })}
    />
  );
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      {routingIssue ? (
        <KitchenRoutingPicker
          issue={routingIssue}
          initial={activeDraft.kitchen_routing}
          onClose={() => {
            pendingCartEdit.current = null;
            setRoutingIssue(null);
          }}
          onRetry={() => {
            setRoutingIssue(null);
            const edit = pendingCartEdit.current;
            pendingCartEdit.current = null;
            if (edit) void checkedEdit(edit).catch(() => undefined);
            else void send();
          }}
          onConfirm={(selected) => {
            const next = { ...activeDraft.kitchen_routing, ...selected };
            setRoutingIssue(null);
            const edit = pendingCartEdit.current;
            pendingCartEdit.current = null;
            if (edit)
              void checkedEdit((current) =>
                edit({ ...current, kitchen_routing: next })
              ).catch(() => undefined);
            else {
              updateDraft((current) => ({ ...current, kitchen_routing: next }));
              void send(next);
            }
          }}
        />
      ) : null}
      {ticketName ? (
        <KitchenTicketSheet
          name={ticketName}
          onClose={() => {
            setTicketName(null);
            setRoundsOpen(true);
          }}
        />
      ) : null}
      {customizing ? (
        <ModifierPicker
          key={customizing.lineId || customizing.item.item_code}
          itemName={customizing.item.item_name}
          groups={customizing.groups}
          currency={currency}
          initial={
            activeDraft.unsent.find((row) => row.line_id === customizing.lineId)
              ?.modifiers
          }
          onClose={() => setCustomizing(null)}
          onConfirm={(choices) => {
            if (customizing.lineId)
              void checkedEdit((current) => ({
                ...current,
                unsent: current.unsent.map((line) =>
                  line.line_id === customizing.lineId
                    ? { ...line, modifiers: choices }
                    : line
                ),
              })).catch(() => undefined);
            else void addItem(customizing.item, choices);
            setCustomizing(null);
          }}
        />
      ) : null}
      <SellingWorkspace
        items={needsTable ? [] : visibleItems}
        isLoading={menu.isLoading}
        currency={currency}
        hideImages={bootstrap.data?.hide_images}
        pendingItemCode={pending}
        query={query}
        onQueryChange={setQuery}
        view={view}
        onViewChange={(value) => {
          setView(value);
          window.localStorage.setItem("vunapos.catalogue-view", value);
        }}
        onAddItem={(item) => {
          if (!readOnly) void addItem(item);
        }}
        onScan={scan}
        onOpenCamera={() => {
          if (needsTable) setTablePicker(true);
          else setCameraOpen(true);
        }}
        categories={
          <>
            <div className="mt-3 xl:hidden">{context}</div>
            {needsTable ? (
              <div className="my-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 text-sm">
                <p className="mb-3">
                  Select a table to view its menu and add dine-in items.
                </p>
                <Button onClick={() => setTablePicker(true)}>
                  Select table
                </Button>
              </div>
            ) : null}
            <div
              className="mt-3 flex gap-2 overflow-x-auto"
              aria-label="Menu categories"
            >
              {[
                { item_group: "", label: "All" },
                ...(menu.menu?.categories || []),
              ].map((row) => (
                <button
                  key={row.item_group}
                  type="button"
                  aria-pressed={category === row.item_group}
                  className={`shrink-0 cursor-pointer rounded-full border px-3 py-1 text-sm ${
                    category === row.item_group
                      ? "bg-primary text-on-primary"
                      : "border-outline-variant"
                  }`}
                  onClick={() => setCategory(row.item_group)}
                >
                  {row.label}
                </button>
              ))}
            </div>
          </>
        }
        mobileCart={renderCart("min-h-0 flex-1")}
        mobileCartOpen={cartOpen}
        onMobileCartOpenChange={setCartOpen}
        cartQuantity={(visibleDraft || activeDraft).unsent.reduce(
          (sum, row) => sum + row.qty,
          0
        )}
      >
        {renderCart("hidden xl:flex")}
      </SellingWorkspace>
      {tablePicker ? (
        <TablePlanPicker
          plan={floor.plan}
          statuses={status.data}
          multiple={Boolean(session)}
          selectedTables={
            session
              ? selectedTables
              : activeDraft.table
              ? [activeDraft.table]
              : []
          }
          busy={busy}
          loading={floor.isLoading || status.isLoading}
          error={error || floor.error || status.error}
          onRetry={() => {
            floor.reload();
            void status.refresh();
          }}
          onSelect={(table) => void pickTable(table)}
          onClose={() => setTablePicker(false)}
          footer={
            session ? (
              <Button
                disabled={busy || !selectedTables.length}
                onClick={async () => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  setBusy(true);
                  try {
                    await updateRestaurantSession(updateCall.call, {
                      session: session.name,
                      tables: selectedTables,
                    });
                    const first = floor.plan?.floors
                      .flatMap((row) => row.tables)
                      .find((row) => row.name === selectedTables[0]);
                    updateDraft((current) => ({
                      ...current,
                      table: first?.name || null,
                      table_label: first?.table_label || null,
                    }));
                    markChanged();
                    await result.refresh();
                    setTablePicker(false);
                    setCartOpen(false);
                  } catch (caught) {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "Unable to update tables."
                    );
                  } finally {
                    inFlight.current = false;
                    setBusy(false);
                  }
                }}
              >
                Save assigned tables ({selectedTables.length})
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <Sheet
        isOpen={roundsOpen}
        title="Placed orders"
        onClose={() => setRoundsOpen(false)}
      >
        <p className="mb-3 text-sm font-semibold">
          Committed total:{" "}
          {formatCurrency(
            session ? committedSessionTotal(session) : 0,
            currency
          )}
        </p>
        <p className="mb-3 text-xs text-on-surface-variant">
          {session?.name} · Waiter: {session?.waiter_name || session?.waiter}
        </p>
        {session?.available_waiters?.length ? (
          <label className="mb-3 block text-sm">
            Assign waiter{" "}
            <select
              className="rounded border border-outline-variant bg-surface p-2"
              value={session.waiter}
              disabled={busy}
              onChange={(event) => {
                setBusy(true);
                void updateRestaurantSession(updateCall.call, {
                  session: session.name,
                  waiter: event.target.value,
                })
                  .then(() => {
                    markChanged();
                    return result.refresh();
                  })
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "Unable to assign waiter."
                    )
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <option value={session.waiter}>
                {session.waiter_name || session.waiter}
              </option>
              {session.available_waiters
                .filter((user) => user.name !== session.waiter)
                .map((user) => (
                  <option key={user.name} value={user.name}>
                    {user.full_name || user.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {session &&
        !session.rounds.some((order) => order.status !== "Cancelled") &&
        !activeDraft.unsent.length ? (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await cancelEmptyRestaurantSession(
                  cancelCall.call,
                  session.name
                );
                setOpenedSession(null);
                setDraft(null);
                markChanged();
                guard.discardAndLeave("Home");
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Unable to release empty session."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Close session and release tables
          </Button>
        ) : null}
        {session?.rounds.map((round, index) => (
          <details
            key={round.name}
            className="mb-2 rounded-md border border-outline-variant p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              Order {index + 1} · {round.name} ·{" "}
              {formatCurrency(round.grand_total || 0, currency)}
            </summary>
            <ul className="mt-2 space-y-2 text-sm">
              {round.items.map((line) => (
                <li key={line.line_id}>
                  {line.qty} {line.uom} × {line.item_name}
                  {line.modifiers?.length ? (
                    <p className="text-xs text-on-surface-variant">
                      {line.modifiers.map((choice) => choice.label).join(" · ")}
                    </p>
                  ) : null}
                  {line.note ? (
                    <p className="text-xs text-on-surface-variant">
                      {line.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {(session.kitchen_tickets || [])
                .filter((ticket) => ticket.sales_order === round.name)
                .map((ticket) => (
                  <Button
                    key={ticket.name}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRoundsOpen(false);
                      setTicketName(ticket.name);
                    }}
                  >
                    {ticket.station_label} · {ticket.name} · {ticket.status}
                  </Button>
                ))}
            </div>
          </details>
        ))}
      </Sheet>
      <BarcodeScannerDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(value) => {
          setCameraOpen(false);
          scan(value);
        }}
      />
      <VariantPickerDialog
        isOpen={Boolean(template)}
        template={template}
        variants={variants}
        currency={currency}
        isLoading={variantsCall.loading}
        error={error}
        onClose={() => {
          variantRequest.current++;
          setTemplate(null);
        }}
        onSelect={(item) => {
          variantRequest.current++;
          setTemplate(null);
          void addItem(item);
        }}
      />
      <ConfirmDialog
        isOpen={guard.pendingPage !== null}
        title="Discard unplaced items?"
        description="Placed orders remain saved. Only unplaced cart items will be discarded."
        confirmLabel="Discard"
        confirmDisabled={busy}
        loading={busy}
        onConfirm={() => {
          const target = guard.pendingPage;
          if (target) {
            setOpenedSession(null);
            setDraft(null);
            guard.discardAndLeave(target);
          }
        }}
        onCancel={guard.stay}
      />
      <ConfirmDialog
        isOpen={clearConfirm}
        title="Clear cart?"
        description="Only unplaced items will be removed. Placed orders remain saved."
        confirmLabel="Clear cart"
        danger
        confirmDisabled={busy}
        onConfirm={() => {
          cartEditEpoch.current++;
          updateDraft((current) => ({ ...current, unsent: [] }));
          setClearConfirm(false);
        }}
        onCancel={() => setClearConfirm(false)}
      />
    </div>
  );
}
