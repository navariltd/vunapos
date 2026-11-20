import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { VunaApiError } from "../../services/vunaApi";
import { getTableMenu, getTableOrder, getTableOrderStatus, placeTableOrder } from "../../services/tableOrderApi";
import type { ItemDTO } from "../pos/types";
import { formatCurrency } from "../pos/utils";
import { KioskCart } from "../kiosk/components/KioskCart";
import { kioskSubtotal } from "../kiosk/kioskFlow";
import { MenuPanel } from "../restaurant/components/MenuPanel";
import { ModifierPicker } from "../restaurant/components/ModifierPicker";
import { newId } from "../restaurant/ids";
import { addMenuItem, lineInput, removeUnsent, setUnsentNote, setUnsentQty, type UnsentLine } from "../restaurant/orderDraft";
import type { MenuDTO, ModifierGroupDTO, SelectedModifier, TableOrderSetupDTO } from "../restaurant/types";
import {
  SENT_MESSAGE,
  STATUS_POLL_SECONDS,
  backToMenu,
  parseSentOrder,
  resumeSentOrder,
  reviewTableOrder,
  sentOrderStorageKey,
  startTableOrder,
  tableCartQuantity,
  tableOrderSent,
  updateTableCart,
  withStatus,
  type TableOrderState,
} from "./tableOrderFlow";

const OCCUPIED = "This table already has an order. Please ask a waiter to add items.";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readSentOrder(token: string) {
  try {
    return parseSentOrder(window.sessionStorage.getItem(sentOrderStorageKey(token)));
  } catch {
    return null;
  }
}

function storeSentOrder(token: string, value: TableOrderState["sent"]) {
  try {
    if (value) window.sessionStorage.setItem(sentOrderStorageKey(token), JSON.stringify(value));
    else window.sessionStorage.removeItem(sentOrderStorageKey(token));
  } catch {
    // Without storage a refresh shows the menu again; the order itself is safe.
  }
}

// The page a guest reaches by scanning a table's QR code on their own phone. Guests
// never sign in: the table comes from the code and staff accept the order.
export function TableOrderApp({ token }: { token: string }) {
  const [setup, setSetup] = useState<{ data: TableOrderSetupDTO | null; error: string | null }>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getTableOrder(token)
      .then((data) => {
        if (active) setSetup({ data, error: null });
      })
      .catch((error: unknown) => {
        if (active) setSetup({ data: null, error: errorMessage(error, "This QR code could not be opened.") });
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);

  const loadSetup = () => {
    setSetup({ data: null, error: null });
    setAttempt((value) => value + 1);
  };

  if (setup.error)
    return (
      <GuestMessage title="Sorry" message={setup.error}>
        <Button size="lg" onClick={loadSetup}>
          Try again
        </Button>
      </GuestMessage>
    );
  if (!setup.data) return <GuestMessage title="Loading" message="Getting the menu ready…" busy />;
  return <TableOrderScreen token={token} setup={setup.data} />;
}

function TableOrderScreen({ token, setup }: { token: string; setup: TableOrderSetupDTO }) {
  const currency = setup.currency || undefined;
  const [state, setState] = useState<TableOrderState>(() =>
    resumeSentOrder(startTableOrder(setup.service_type, newId), readSentOrder(token)),
  );
  const [occupied, setOccupied] = useState(setup.state === "occupied");
  const [menu, setMenu] = useState<{ data: MenuDTO | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [customizing, setCustomizing] = useState<{ item: ItemDTO; groups: ModifierGroupDTO[]; line?: UnsentLine } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const [menuAttempt, setMenuAttempt] = useState(0);
  const ordering = !occupied && state.step !== "sent";
  useEffect(() => {
    if (!ordering) return undefined;
    let active = true;
    getTableMenu(token)
      .then((data) => {
        if (active) setMenu({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (active) setMenu({ data: null, error: errorMessage(error, "The menu could not be loaded."), loading: false });
      });
    return () => {
      active = false;
    };
  }, [ordering, token, menuAttempt]);

  const loadMenu = () => {
    setMenu((current) => ({ ...current, loading: true, error: null }));
    setMenuAttempt((value) => value + 1);
  };

  // Staff answer in their own time: check the sent order until they do.
  const pending = state.step === "sent" && state.sent?.status === "Pending" ? state.sent.order : null;
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => {
      getTableOrderStatus(token, pending)
        .then((result) => {
          if (result.status === "Pending") return;
          setState((current) => withStatus(current, result.status));
          storeSentOrder(token, result);
        })
        .catch(() => undefined);
    }, STATUS_POLL_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [pending, token]);

  const rates = useMemo(
    () => new Map((menu.data?.items ?? []).map((item) => [item.item_code, Number(item.rate || 0)])),
    [menu.data],
  );
  const groupsFor = useCallback(
    (itemCode: string, variantOf?: string | null) =>
      menu.data?.modifier_groups?.[itemCode] || menu.data?.modifier_groups?.[variantOf || ""] || [],
    [menu.data],
  );

  const addItem = (item: ItemDTO, modifiers?: SelectedModifier[]) => {
    const groups = groupsFor(item.item_code, item.variant_of);
    if (modifiers === undefined && groups.length) {
      setCustomizing({ item, groups });
      return;
    }
    setState((current) =>
      updateTableCart(current, (draft) =>
        addMenuItem(draft, { item_code: item.item_code, item_name: item.item_name, uom: item.uom, modifiers }, newId),
      ),
    );
  };

  const send = async () => {
    if (sendingRef.current || !state.draft.unsent.length) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const result = await placeTableOrder({
        token,
        items: state.draft.unsent.map(lineInput),
        idempotency_key: state.draft.idempotency_key,
      });
      setState((current) => tableOrderSent(current, result));
      storeSentOrder(token, result);
    } catch (error) {
      if (error instanceof VunaApiError && error.code === "TABLE_HAS_ORDER") setOccupied(true);
      else setSendError(errorMessage(error, "Your order could not be sent. Please try again."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const orderAgain = () => {
    storeSentOrder(token, null);
    setState(startTableOrder(setup.service_type, newId));
    setSendError(null);
  };

  const quantity = tableCartQuantity(state);
  const subtotal = kioskSubtotal(state.draft, rates);
  const place = [setup.floor_name, `Table ${setup.table_label}`].filter(Boolean).join(" · ");

  let body: ReactNode;
  if (state.step === "sent" && state.sent) {
    const status = state.sent.status;
    const Icon = status === "Accepted" ? CheckCircle2 : status === "Rejected" ? XCircle : Clock;
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-4 px-2 text-center" aria-live="polite">
        <Icon className={status === "Rejected" ? "size-16 text-error" : "size-16 text-primary"} aria-hidden="true" />
        <h2 className="text-2xl font-semibold text-on-surface">{SENT_MESSAGE[status].title}</h2>
        <p className="max-w-sm text-lg text-on-surface-variant">{SENT_MESSAGE[status].detail}</p>
        {status === "Pending" ? (
          <p className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Waiting for a waiter
          </p>
        ) : null}
        {status === "Rejected" ? (
          <Button size="lg" variant="ghost" onClick={orderAgain}>
            Start a new order
          </Button>
        ) : null}
      </section>
    );
  } else if (occupied) {
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center" role="status">
        <h2 className="text-2xl font-semibold text-on-surface">{OCCUPIED}</h2>
      </section>
    );
  } else if (state.step === "review") {
    body = (
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-outline-variant bg-surface p-4">
        <KioskCart
          lines={state.draft.unsent}
          currency={currency}
          subtotal={subtotal}
          onQty={(lineId, qty) => setState((value) => updateTableCart(value, (draft) => setUnsentQty(draft, lineId, qty)))}
          onNote={(lineId, note) => setState((value) => updateTableCart(value, (draft) => setUnsentNote(draft, lineId, note)))}
          onRemove={(lineId) => setState((value) => updateTableCart(value, (draft) => removeUnsent(draft, lineId)))}
          canEditChoices={(line) => groupsFor(line.item_code).length > 0}
          onEditChoices={(line) => {
            const item = menu.data?.items.find((row) => row.item_code === line.item_code);
            if (item) setCustomizing({ item, groups: groupsFor(line.item_code, item.variant_of), line });
          }}
          footer={
            <>
              {sendError ? (
                <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-on-error-container">
                  {sendError}
                </p>
              ) : null}
              <p className="text-sm text-on-surface-variant">
                A waiter confirms your order before it goes to the kitchen. You pay when you leave.
              </p>
              <Button size="lg" className="h-14 w-full text-lg" disabled={!quantity || sending} onClick={() => void send()}>
                {sending ? "Sending your order…" : "Send order"}
              </Button>
            </>
          }
        />
      </section>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <MenuPanel
          menu={menu.data}
          isLoading={menu.loading}
          error={menu.error}
          currency={currency}
          quantities={new Map(state.draft.unsent.map((line) => [line.item_code, line.qty]))}
          phoneGrid
          onRetry={loadMenu}
          onAddItem={(item) => addItem(item)}
        />
        <div className="pt-3">
          <Button size="lg" className="h-14 w-full text-lg" disabled={!quantity} onClick={() => setState(reviewTableOrder)}>
            {quantity
              ? `Review order · ${quantity} ${quantity === 1 ? "item" : "items"} · ${formatCurrency(subtotal, currency)}`
              : "Add items to order"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col gap-3 overflow-hidden bg-background p-3 text-on-surface sm:p-5">
      <header className="flex shrink-0 items-center gap-2">
        {state.step === "review" ? (
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setState(backToMenu)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Menu
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-on-surface">{setup.restaurant_name}</h1>
          <p className="truncate text-sm text-on-surface-variant">{place}</p>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{body}</main>
      {customizing ? (
        <ModifierPicker
          key={customizing.line?.line_id || customizing.item.item_code}
          itemName={customizing.item.item_name}
          groups={customizing.groups}
          currency={currency}
          initial={customizing.line?.modifiers}
          onClose={() => setCustomizing(null)}
          onConfirm={(choices) => {
            const line = customizing.line;
            if (line)
              setState((value) =>
                updateTableCart(value, (draft) => ({
                  ...draft,
                  unsent: draft.unsent.map((row) => (row.line_id === line.line_id ? { ...row, modifiers: choices } : row)),
                })),
              );
            else addItem(customizing.item, choices);
            setCustomizing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function GuestMessage({ title, message, busy, children }: { title: string; message: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-6 text-center text-on-surface">
      {busy ? <Loader2 className="size-8 animate-spin text-on-surface-variant" aria-hidden="true" /> : null}
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-sm text-lg text-on-surface-variant">{message}</p>
      {children}
    </div>
  );
}
