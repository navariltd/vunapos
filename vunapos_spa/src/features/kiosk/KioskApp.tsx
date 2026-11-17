import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrappeAuth, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, CheckCircle2, Loader2, RotateCcw } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { printHtml } from "../../lib/printHtml";
import type { CachedServiceType } from "../../lib/types";
import {
  getKioskSetup,
  placeKioskOrder,
  renderInvoice,
  validateRestaurantCart,
  vunaMethods,
} from "../../services/vunaApi";
import { ManagerPinDialog } from "../pos/components/ManagerPinDialog";
import { useBootstrapData } from "../pos/hooks/useBootstrapData";
import type { InvoiceDTO, ItemDTO } from "../pos/types";
import { formatCurrency, normalizeDefaultCustomer } from "../pos/utils";
import { MenuPanel } from "../restaurant/components/MenuPanel";
import { ModifierPicker } from "../restaurant/components/ModifierPicker";
import { useMenu } from "../restaurant/hooks/useOrderData";
import { newId } from "../restaurant/ids";
import {
  addMenuItem,
  lineInput,
  removeUnsent,
  setUnsentNote,
  setUnsentQty,
  type UnsentLine,
} from "../restaurant/orderDraft";
import type { KioskSetupDTO, ModifierGroupDTO, SelectedModifier } from "../restaurant/types";
import { KioskCart } from "./components/KioskCart";
import { KioskTableStep } from "./components/KioskTableStep";
import {
  DONE_SECONDS,
  KIOSK_START,
  back,
  cartQuantity,
  chooseService,
  chooseTable,
  idlePhase,
  idleSecondsLeft,
  kioskSubtotal,
  placed,
  review,
  startOrder,
  tracksIdle,
  updateCart,
  type IdlePhase,
  type KioskState,
} from "./kioskFlow";

const LOGIN_URL = "/login?redirect-to=/vunapos";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
// Holding the restaurant name this long opens the manager PIN to leave the kiosk.
const EXIT_HOLD_MS = 2500;

// The self-service screen for a kiosk login: no navigation, Desk or settings. The
// customer orders like a waiter would, checks out and takes a printed slip.
export function KioskApp() {
  const bootstrap = useBootstrapData();
  const restaurant = bootstrap.data?.restaurant;
  const posProfile = bootstrap.data?.pos_profile;
  if (!bootstrap.data) return <KioskMessage title="Loading" message="Getting the kiosk ready…" />;
  if (bootstrap.data.pos_mode !== "Restaurant" || !restaurant?.kiosk_mode || !posProfile)
    return (
      <KioskMessage
        title="This kiosk is not set up"
        message="Ask a manager to tick Kiosk Mode on this login's Restaurant POS Profile."
        action={<SignOutButton />}
      />
    );
  return <KioskScreen posProfile={posProfile} idleSeconds={restaurant.kiosk_idle_seconds || 90} />;
}

function KioskScreen({ posProfile, idleSeconds }: { posProfile: string; idleSeconds: number }) {
  const bootstrap = useBootstrapData();
  const currency = bootstrap.data?.currency;
  const customer = normalizeDefaultCustomer(bootstrap.data)?.customer ?? null;
  const restaurantName = bootstrap.data?.restaurant?.restaurant_name || bootstrap.data?.company || "Welcome";
  const setupCall = useFrappePostCall(vunaMethods.getKioskSetup);
  const placeCall = useFrappePostCall(vunaMethods.placeKioskOrder);
  const checkCall = useFrappePostCall(vunaMethods.validateRestaurantCart);
  const printCall = useFrappePostCall(vunaMethods.renderInvoice);
  const [state, setState] = useState<KioskState>(KIOSK_START);
  const [setup, setSetup] = useState<{ data: KioskSetupDTO | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [customizing, setCustomizing] = useState<{ item: ItemDTO; groups: ModifierGroupDTO[]; line?: UnsentLine } | null>(null);
  const [checked, setChecked] = useState<{ key: string; invoice: InvoiceDTO | null; error: string | null } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const placingRef = useRef(false);
  const services = setup.data?.service_types ?? [];

  const loadSetup = useCallback(async () => {
    setSetup((current) => ({ ...current, loading: true }));
    try {
      setSetup({ data: await getKioskSetup(setupCall.call, posProfile), error: null, loading: false });
    } catch (error) {
      setSetup((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "The kiosk could not load. Please ask a member of staff.",
      }));
    }
  }, [posProfile, setupCall.call]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  // Table availability changes all the time; refresh it each time a customer reaches that step.
  useEffect(() => {
    if (state.step === "table") void loadSetup();
  }, [state.step, loadSetup]);

  const startOver = useCallback(() => {
    setState(KIOSK_START);
    setCustomizing(null);
    setChecked(null);
    setPlaceError(null);
    setPrintError(null);
  }, []);

  const idle = useIdle(tracksIdle(state.step) && !exitOpen, idleSeconds, startOver);

  const menu = useMenu(
    posProfile,
    state.service?.name,
    state.draft?.table,
    customer,
    null,
    state.step === "menu" || state.step === "review",
  );
  const rates = useMemo(
    () => new Map((menu.menu?.items ?? []).map((item) => [item.item_code, Number(item.rate || 0)])),
    [menu.menu],
  );
  const groupsFor = useCallback(
    (itemCode: string, variantOf?: string | null) =>
      menu.menu?.modifier_groups?.[itemCode] || menu.menu?.modifier_groups?.[variantOf || ""] || [],
    [menu.menu],
  );

  const addItem = (item: ItemDTO, modifiers?: SelectedModifier[]) => {
    const groups = groupsFor(item.item_code, item.variant_of);
    if (modifiers === undefined && groups.length) {
      setCustomizing({ item, groups });
      return;
    }
    setState((current) =>
      updateCart(current, (draft) =>
        addMenuItem(draft, { item_code: item.item_code, item_name: item.item_name, uom: item.uom, modifiers }, newId),
      ),
    );
  };

  // The review shows the server's prices and checks stock, as staff checkout does.
  const items = useMemo(() => (state.draft?.unsent ?? []).map(lineInput), [state.draft?.unsent]);
  const cartKey = JSON.stringify(items);
  useEffect(() => {
    if (state.step !== "review" || !state.draft || !items.length) return undefined;
    let active = true;
    const draft = state.draft;
    void validateRestaurantCart(checkCall.call, {
      pos_profile: posProfile,
      service_type: draft.service_type,
      items,
      table: draft.table,
      customer,
    })
      .then((result) => {
        if (active) setChecked({ key: cartKey, invoice: result.invoice, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setChecked({
            key: cartKey,
            invoice: null,
            error: error instanceof Error ? error.message : "Your order could not be checked. Please try again.",
          });
      });
    return () => {
      active = false;
    };
    // cartKey stands for items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, cartKey, posProfile, customer, checkCall.call]);
  const current = checked?.key === cartKey ? checked : null;

  const checkout = async () => {
    const draft = state.draft;
    if (!draft || placingRef.current || !current?.invoice) return;
    placingRef.current = true;
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await placeKioskOrder(placeCall.call, {
        pos_profile: posProfile,
        service_type: draft.service_type,
        items,
        idempotency_key: draft.idempotency_key,
        table: draft.table,
      });
      setState((value) => placed(value, order));
      try {
        const slip = await renderInvoice(printCall.call, {
          invoice_doctype: "Sales Order",
          invoice_name: order.sales_order,
          print_format: order.print_format,
        });
        printHtml(slip.html);
      } catch {
        setPrintError("Your slip could not be printed. Please remember your order number.");
      }
    } catch (error) {
      setPlaceError(error instanceof Error ? error.message : "Your order could not be placed. Please try again.");
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  useEffect(() => {
    if (state.step !== "done") return undefined;
    const timer = window.setTimeout(startOver, DONE_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [state.step, startOver]);

  const quantity = cartQuantity(state);
  const subtotal = kioskSubtotal(state.draft, rates);
  const cart = (footer: ReactNode) => (
    <KioskCart
      lines={state.draft?.unsent ?? []}
      currency={currency}
      subtotal={subtotal}
      onQty={(lineId, qty) => setState((value) => updateCart(value, (draft) => setUnsentQty(draft, lineId, qty)))}
      onNote={(lineId, note) => setState((value) => updateCart(value, (draft) => setUnsentNote(draft, lineId, note)))}
      onRemove={(lineId) => setState((value) => updateCart(value, (draft) => removeUnsent(draft, lineId)))}
      canEditChoices={(line) => groupsFor(line.item_code).length > 0}
      onEditChoices={(line) => {
        const item = menu.menu?.items.find((row) => row.item_code === line.item_code);
        if (item) setCustomizing({ item, groups: groupsFor(line.item_code, item.variant_of), line });
      }}
      footer={footer}
    />
  );

  let body: ReactNode;
  if (state.step === "start") {
    body = (
      <button
        type="button"
        className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-6 rounded-3xl bg-primary p-8 text-on-primary"
        disabled={setup.loading && !setup.data}
        onClick={() => {
          if (!setup.data) {
            void loadSetup();
            return;
          }
          requestFullscreen();
          idle.keepGoing();
          setState(startOrder(services, posProfile, newId));
        }}
      >
        <span className="text-5xl font-bold sm:text-7xl">Tap to order</span>
        <span className="text-xl sm:text-2xl">
          {setup.error ? setup.error : setup.data ? "Order here, then pay at the counter" : "Getting ready…"}
        </span>
      </button>
    );
  } else if (state.step === "service") {
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-8" aria-labelledby="kiosk-service-title">
        <h2 id="kiosk-service-title" className="text-3xl font-semibold text-on-surface sm:text-4xl">
          Where will you eat?
        </h2>
        <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          {services.map((service: CachedServiceType) => (
            <button
              key={service.name}
              type="button"
              className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-surface p-6 text-center hover:bg-primary-container"
              onClick={() => setState((value) => chooseService(value, service, posProfile, newId))}
            >
              <span className="text-3xl font-semibold text-on-surface">{service.service_type_name}</span>
              {service.description ? <span className="text-on-surface-variant">{service.description}</span> : null}
            </button>
          ))}
        </div>
      </section>
    );
  } else if (state.step === "table") {
    body = (
      <KioskTableStep
        plan={setup.data?.floor_plan ?? null}
        statuses={setup.data?.tables ?? null}
        loading={setup.loading}
        error={setup.error}
        onRetry={() => void loadSetup()}
        onSelect={(table) => setState((value) => chooseTable(value, table))}
        onBack={() => setState((value) => back(value, services.length))}
        onStartOver={startOver}
      />
    );
  } else if (state.step === "menu") {
    const reviewButton = (
      <Button size="lg" className="h-16 w-full text-xl" disabled={!quantity} onClick={() => setState(review)}>
        Review order{quantity ? ` · ${quantity} ${quantity === 1 ? "item" : "items"}` : ""}
      </Button>
    );
    body = (
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="kiosk-menu flex min-h-0 min-w-0 flex-1 flex-col">
          <MenuPanel
            menu={menu.menu}
            isLoading={menu.isLoading}
            error={menu.error}
            currency={currency}
            quantities={new Map((state.draft?.unsent ?? []).map((line) => [line.item_code, line.qty]))}
            onRetry={menu.reload}
            onAddItem={(item) => addItem(item)}
          />
          <div className="mt-3 lg:hidden">{reviewButton}</div>
        </div>
        <aside className="hidden min-h-0 w-[26rem] shrink-0 flex-col rounded-2xl border border-outline-variant bg-surface p-4 lg:flex">
          {cart(reviewButton)}
        </aside>
      </div>
    );
  } else if (state.step === "review") {
    const total = current?.invoice ? current.invoice.totals.rounded_total || current.invoice.totals.grand_total : null;
    body = (
      <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col rounded-2xl border border-outline-variant bg-surface p-4 sm:p-6">
        <p className="mb-2 text-on-surface-variant">
          {state.service?.service_type_name}
          {state.draft?.table_label ? ` · Table ${state.draft.table_label}` : ""}
        </p>
        {cart(
          <>
            {current?.error || placeError ? (
              <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-on-error-container">
                {placeError || current?.error}
              </p>
            ) : null}
            <p className="flex justify-between text-2xl font-bold text-on-surface">
              <span>Total</span>
              <span>{total === null ? <Loader2 className="size-6 animate-spin" aria-label="Checking your order" /> : formatCurrency(total, currency)}</span>
            </p>
            <p className="text-on-surface-variant">You pay at the counter after checking out.</p>
            <Button
              size="lg"
              className="h-16 w-full text-xl"
              disabled={!quantity || placing || !current?.invoice}
              onClick={() => void checkout()}
            >
              {placing ? "Placing your order…" : "Checkout"}
            </Button>
          </>,
        )}
      </section>
    );
  } else {
    const order = state.placed;
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center" aria-live="polite">
        <CheckCircle2 className="size-20 text-primary" aria-hidden="true" />
        <p className="text-2xl text-on-surface-variant">Your order number is</p>
        <p className="text-8xl font-bold text-on-surface">{order?.order_number}</p>
        <p className="text-3xl font-semibold text-on-surface">
          {order?.kiosk_status === "Awaiting Payment"
            ? "Please pay at the counter"
            : "Your order is with the kitchen. Please pay at the counter before you leave."}
        </p>
        {order?.kiosk_status === "Awaiting Payment" ? (
          <p className="text-xl text-on-surface-variant">We start preparing it as soon as you have paid.</p>
        ) : null}
        <p className="text-xl text-on-surface-variant">
          Total {formatCurrency(order?.rounded_total || order?.grand_total, order?.currency || currency)}
          {order?.table_label ? ` · Table ${order.table_label}` : ""}
        </p>
        {printError ? <p className="text-lg text-error">{printError}</p> : <p className="text-lg text-on-surface-variant">Take your printed slip.</p>}
        <Button size="lg" className="h-16 px-10 text-xl" onClick={startOver}>
          Done
        </Button>
      </section>
    );
  }

  const canGoBack = ["service", "menu", "review"].includes(state.step);
  return (
    <div className="kiosk flex h-[100dvh] flex-col gap-4 overflow-hidden bg-background p-4 text-on-surface sm:p-6">
      <header className="flex shrink-0 items-center gap-3">
        <ExitHold onOpen={() => setExitOpen(true)}>
          <span className="text-xl font-semibold text-on-surface sm:text-2xl">{restaurantName}</span>
        </ExitHold>
        <span className="flex-1" />
        {canGoBack ? (
          <Button variant="ghost" size="lg" className="gap-2" onClick={() => setState((value) => back(value, services.length))}>
            <ArrowLeft className="size-5" aria-hidden="true" />
            Back
          </Button>
        ) : null}
        {state.step !== "start" && state.step !== "done" ? (
          <Button variant="ghost" size="lg" className="gap-2" onClick={startOver}>
            <RotateCcw className="size-5" aria-hidden="true" />
            Start over
          </Button>
        ) : null}
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
                updateCart(value, (draft) => ({
                  ...draft,
                  unsent: draft.unsent.map((row) => (row.line_id === line.line_id ? { ...row, modifiers: choices } : row)),
                })),
              );
            else addItem(customizing.item, choices);
            setCustomizing(null);
          }}
        />
      ) : null}
      {idle.phase === "warning" ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="kiosk-idle-title">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-8 text-center shadow-xl">
            <h2 id="kiosk-idle-title" className="text-3xl font-semibold text-on-surface">
              Still there?
            </h2>
            <p className="mt-3 text-xl text-on-surface-variant">
              Your order will be cleared in {idle.secondsLeft} seconds.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button size="lg" className="h-16 text-lg" onClick={idle.keepGoing}>
                Continue my order
              </Button>
              <Button size="lg" variant="ghost" className="h-16 text-lg" onClick={startOver}>
                Start over
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <KioskExit
        isOpen={exitOpen}
        posProfile={posProfile}
        onClose={() => {
          idle.keepGoing();
          setExitOpen(false);
        }}
      />
    </div>
  );
}

// Counts inactivity while a customer is ordering: a prompt after `idleSeconds`, then a
// fresh start after the warning. Whatever starts tracking calls keepGoing first.
function useIdle(enabled: boolean, idleSeconds: number, onExpired: () => void) {
  const [lastActivity, setLastActivity] = useState(0);
  const [now, setNow] = useState(0);
  const phaseRef = useRef<IdlePhase>("active");
  const keepGoing = useCallback(() => {
    const time = Date.now();
    setLastActivity(time);
    setNow(time);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    // Once the prompt is up, only its buttons count.
    const mark = () => {
      if (phaseRef.current === "active") setLastActivity(Date.now());
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, mark, { passive: true }));
    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, mark));
    };
  }, [enabled]);

  const idleMs = enabled ? Math.max(0, now - lastActivity) : 0;
  const phase = enabled ? idlePhase(idleMs, idleSeconds) : "active";
  useEffect(() => {
    phaseRef.current = phase;
    if (phase === "expired") onExpired();
  }, [phase, onExpired]);
  return { phase, secondsLeft: idleSecondsLeft(idleMs, idleSeconds), keepGoing };
}

// A long press on the restaurant name: staff can reach the manager PIN, customers won't.
function ExitHold({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div
      className="select-none"
      onPointerDown={() => {
        cancel();
        timer.current = window.setTimeout(onOpen, EXIT_HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

function KioskExit({ isOpen, posProfile, onClose }: { isOpen: boolean; posProfile: string; onClose: () => void }) {
  const { logout } = useFrappeAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ManagerPinDialog
        isOpen={isOpen}
        posProfile={posProfile}
        action="kiosk_exit"
        onCancel={onClose}
        onApproved={() => {
          void exitFullscreen()
            .then(() => logout())
            .then(() => window.location.assign(LOGIN_URL))
            .catch(() => setError("Could not sign out. Check the connection and try again."));
        }}
      />
      {error ? (
        <p role="alert" className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-md bg-error-container px-4 py-2 text-on-error-container">
          {error}
        </p>
      ) : null}
    </>
  );
}

function SignOutButton() {
  const { logout } = useFrappeAuth();
  return (
    <Button size="lg" onClick={() => void logout().then(() => window.location.assign(LOGIN_URL))}>
      Sign out
    </Button>
  );
}

function KioskMessage({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className={cn("flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-6 text-center text-on-surface")}>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="max-w-lg text-lg text-on-surface-variant">{message}</p>
      {action}
    </div>
  );
}

function requestFullscreen() {
  // Best effort: the device's own kiosk mode does the real lock-down.
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen().catch(() => undefined);
}

function exitFullscreen() {
  return document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(() => undefined) : Promise.resolve();
}
