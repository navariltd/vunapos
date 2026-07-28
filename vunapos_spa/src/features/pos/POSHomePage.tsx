import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, X } from "lucide-react";

import type { HeldInvoiceDTO, ItemDTO, PaymentInput, PrintPayload } from "./types";
import { getInvoiceTotal, getPaymentModes, normalizeDefaultCustomer } from "./utils";
import { getCustomerFromPath, getInvoiceFromPath, navigateToPosPage, useNavigationStore } from "../../lib/stores/navigationStore";
import { VunaApiError } from "../../services/vunaApi";
import { CartPanel } from "./components/CartPanel";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { CustomersPage } from "../customers/CustomersPage";
import { CustomerDetailsPage } from "../customers/CustomerDetailsPage";
import { PaymentsPage } from "../payments/PaymentsPage";
import { CheckoutDialog } from "./components/CheckoutDialog";
import { CloseShiftPage } from "./components/CloseShiftPage";
import { InvoicesPage } from "./components/InvoicesPage";
import { InvoiceDetailsPage } from "./components/InvoiceDetailsPage";
import { ItemGrid } from "./components/ItemGrid";
import { ItemSearch } from "./components/ItemSearch";
import { useBootstrapData } from "./hooks/useBootstrapData";
import { useCartActions } from "./hooks/useCartActions";
import { useConnectivity } from "./hooks/useConnectivity";
import { useHeldInvoicesView } from "./hooks/useHeldInvoicesView";
import { useItemSearch } from "./hooks/useItemSearch";
import { getActiveCustomer, isUnsyncedLocalCart, useCartStore } from "./stores/cartStore";
import { useUiFeedbackStore } from "./stores/uiFeedbackStore";

type POSHomePageProps = {
	bootstrap?: ReturnType<typeof useBootstrapData>;
};

function printInvoiceHtml(printPayload: PrintPayload) {
	const printFrame = document.createElement("iframe");
	printFrame.style.position = "fixed";
	printFrame.style.right = "0";
	printFrame.style.bottom = "0";
	printFrame.style.width = "0";
	printFrame.style.height = "0";
	printFrame.style.border = "0";
	printFrame.setAttribute("aria-hidden", "true");
	document.body.appendChild(printFrame);

	const printDocument = printFrame.contentWindow?.document;
	if (!printDocument) {
		printFrame.remove();
		return;
	}

	printDocument.open();
	printDocument.write(printPayload.html);
	printDocument.close();

	window.setTimeout(() => {
		printFrame.contentWindow?.focus();
		printFrame.contentWindow?.print();
		window.setTimeout(() => printFrame.remove(), 1000);
	}, 100);
}

function getCheckoutErrorMessage(error: unknown) {
	if (error instanceof VunaApiError) {
		if (error.code === "PAYMENT_TOTAL_MISMATCH") {
			return "Payment amount must match the invoice total.";
		}
		if (error.code === "INVOICE_ALREADY_SUBMITTED") {
			return "This invoice has already been submitted.";
		}
		if (error.code === "EMPTY_INVOICE") {
			return "Add at least one item before checkout.";
		}
	}
	return error instanceof Error ? error.message : "Checkout failed";
}

export function POSHomePage({ bootstrap: providedBootstrap }: POSHomePageProps) {
	const [itemSearchQuery, setItemSearchQuery] = useState("");
	const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
	const [isCartOpen, setIsCartOpen] = useState(false);
	const [clearCartConfirmation, setClearCartConfirmation] = useState<{ closeCheckout: boolean } | null>(null);
	const activePage = useNavigationStore((s) => s.activePage);
	const currentPath = useNavigationStore((s) => s.currentPath);
	const setActivePage = useNavigationStore((s) => s.setActivePage);
	const pageError = useUiFeedbackStore((s) => s.pageError);
	const setPageError = useUiFeedbackStore((s) => s.setPageError);
	const toast = useUiFeedbackStore((s) => s.toast);
	const toastClosing = useUiFeedbackStore((s) => s.toastClosing);
	const showToast = useUiFeedbackStore((s) => s.showToast);
	const clearToast = useUiFeedbackStore((s) => s.clearToast);

	const ownBootstrap = useBootstrapData();
	const bootstrap = providedBootstrap || ownBootstrap;
	const defaultCustomer = useMemo(() => normalizeDefaultCustomer(bootstrap.data), [bootstrap.data]);
	const paymentModes = useMemo(() => getPaymentModes(bootstrap.data), [bootstrap.data]);

	const items = useItemSearch(itemSearchQuery);
	const cartInvoice = useCartStore((s) => s.invoice);
	const activeCustomer = useCartStore(getActiveCustomer);
	const heldInvoicesView = useHeldInvoicesView();
	const cartIsMutating = useCartStore((s) => s.isMutating);
	const cartIsHeldLoading = useCartStore((s) => s.isHeldLoading);
	const cartError = useCartStore((s) => s.error);
	const setCartPosProfile = useCartStore((s) => s.setPosProfile);
	const setCartDefaultCustomer = useCartStore((s) => s.setDefaultCustomer);
	const setSelectedCustomer = useCartStore((s) => s.setSelectedCustomer);
	const cartActions = useCartActions();
	const { isReachable } = useConnectivity();

	const error = pageError || bootstrap.error || items.error;

	useEffect(() => {
		if (cartError) showToast({ type: "error", message: cartError });
	}, [cartError, showToast]);

	useEffect(() => {
		setCartPosProfile(bootstrap.data?.pos_profile);
	}, [bootstrap.data?.pos_profile, setCartPosProfile]);

	useEffect(() => {
		setCartDefaultCustomer(defaultCustomer);
	}, [defaultCustomer, setCartDefaultCustomer]);

	useEffect(() => {
		// Skip the fetch when offline: frappe-react-sdk throws a raw TypeError on a pure
		// network failure (reads error.response.data unconditionally). isReachable can
		// lag a disconnect by a beat, so also check navigator.onLine as a last-instant guard.
		if (!bootstrap.data?.pos_profile || !isReachable || navigator.onLine === false) {
			return;
		}

		cartActions.listHeld().catch((err) => {
			setPageError(err instanceof Error ? err.message : "Failed to load held invoices");
		});
		// cartActions is a fresh object each render (see useCartActions) - keying on its
		// stable inputs instead avoids re-firing every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [bootstrap.data?.pos_profile, isReachable, setPageError]);

	const handleAddItem = async (item: ItemDTO) => {
		setPageError(null);
		clearToast();
		try {
			await cartActions.addCartItem(item);
		} catch (err) {
			showToast({ type: "error", message: err instanceof Error ? err.message : "Failed to add item" });
		}
	};

	const handleOpenCheckout = async () => {
		setPageError(null);
		if (!activeCustomer?.customer) {
			setPageError("Select a customer, or set a default customer on this POS Profile, before checkout");
			return;
		}
		setIsCartOpen(false);
		setIsCheckoutOpen(true);
	};

	const handleClearCart = (closeCheckout = false) => {
		if (cartInvoice?.items?.length) {
			setClearCartConfirmation({ closeCheckout });
			return false;
		}
		void cartActions.clearCart();
		return true;
	};

	const confirmClearCart = () => {
		const closeCheckout = Boolean(clearCartConfirmation?.closeCheckout);
		setClearCartConfirmation(null);
		void cartActions.clearCart();
		if (closeCheckout) setIsCheckoutOpen(false);
	};

	const handleHoldCart = async () => {
		setPageError(null);
		clearToast();
		// A brand-new local cart holds itself via the offline queue, no connectivity
		// needed. Only the two online-only branches (editing/holding an already
		// server-tracked invoice) need this guard, for the same frappe-react-sdk
		// raw-TypeError-on-network-failure reason as the fetch guard above.
		if (!isUnsyncedLocalCart(cartInvoice) && (!isReachable || navigator.onLine === false)) {
			setPageError("Holding invoices needs a connection - try again once you're back online.");
			return;
		}
		try {
			const heldInvoice = await cartActions.holdCart();
			if (heldInvoice) {
				showToast({ type: "held", invoice: heldInvoice });
				setSelectedCustomer(undefined);
				setIsCartOpen(false);
				return true;
			}
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to hold invoice");
		}
		return false;
	};

	const handleRefreshHeld = async () => {
		setPageError(null);
		if (!isReachable || navigator.onLine === false) {
			setPageError("Held invoices need a connection - try again once you're back online.");
			return;
		}
		try {
			await cartActions.listHeld();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to load held invoices");
		}
	};

	useEffect(() => {
		if (activePage === "Invoices") {
			handleRefreshHeld();
		}
		// handleRefreshHeld is recreated every render (not memoized) - keying on
		// activePage alone is correct, it's the only thing this should react to.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activePage]);

	const handleRestoreHeld = async (heldInvoice: HeldInvoiceDTO) => {
		setPageError(null);
		clearToast();
		try {
			const restoredInvoice =
				heldInvoice.is_local && heldInvoice.local_id
					? await cartActions.restoreLocalHold(heldInvoice.local_id)
					: await cartActions.restoreHeldInvoice(heldInvoice);
			setSelectedCustomer(
				restoredInvoice.customer
					? {
							customer: restoredInvoice.customer,
							customer_name: restoredInvoice.customer_name || restoredInvoice.customer,
						}
					: null,
			);
			setActivePage("Home");
			setIsCartOpen(true);
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to restore held invoice");
		}
	};

	const handleCheckout = async (payments: PaymentInput[], idempotencyKey: string) => {
		setPageError(null);
		try {
			const result = await cartActions.submitCart(
				payments,
				bootstrap.data?.print_format,
				idempotencyKey,
				isReachable && navigator.onLine !== false,
			);
			setIsCheckoutOpen(false);
			setSelectedCustomer(undefined);
			if (result?.invoice) {
				showToast({ type: "submitted", invoice: result.invoice });
			} else {
				clearToast();
			}
			if (result?.printPayload) {
				printInvoiceHtml(result.printPayload);
			}
		} catch (err) {
			setPageError(getCheckoutErrorMessage(err));
		}
	};

	if (bootstrap.isLoading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<p className="text-sm font-medium text-on-surface-variant">Loading POS workspace...</p>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
			{error ? (
				<div className="mx-4 mb-3 mt-4 shrink-0 rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container">
					{error}
				</div>
			) : null}

			{activePage === "Invoices" ? (
				getInvoiceFromPath(currentPath) ? <InvoiceDetailsPage invoice={getInvoiceFromPath(currentPath) || ""} posProfile={bootstrap.data?.pos_profile} isOnline={isReachable && navigator.onLine !== false} onStartSale={(customer) => { setSelectedCustomer(customer); navigateToPosPage("Home"); }}/> : <InvoicesPage posProfile={bootstrap.data?.pos_profile} currency={bootstrap.data?.currency} paymentModes={paymentModes} heldInvoices={heldInvoicesView} heldLoading={cartIsHeldLoading} onBack={() => setActivePage("Home")} onRefreshHeld={handleRefreshHeld} onRestoreHeld={handleRestoreHeld}/>
			) : activePage === "Payments" ? (
				<PaymentsPage posProfile={bootstrap.data?.pos_profile} currency={bootstrap.data?.currency} paymentModes={paymentModes} isOnline={isReachable && navigator.onLine !== false} />
			) : activePage === "Customers" ? (
				getCustomerFromPath(currentPath) ? <CustomerDetailsPage
					customer={getCustomerFromPath(currentPath) || ""}
					posProfile={bootstrap.data?.pos_profile}
					onStartSale={(customer) => {
						setSelectedCustomer(customer);
						navigateToPosPage("Home");
					}}
				/> : <CustomersPage posProfile={bootstrap.data?.pos_profile} defaultCurrency={bootstrap.data?.currency} />
			) : activePage === "Close Shift" ? (
				bootstrap.data?.pos_profile ? (
					<CloseShiftPage
						currency={bootstrap.data.currency}
						posProfile={bootstrap.data.pos_profile}
						onBack={() => navigateToPosPage("Home")}
					/>
				) : (
					<section className="flex h-full items-center justify-center p-6">
						<p className="text-sm text-on-surface-variant">Loading the POS Profile for shift closing...</p>
					</section>
				)
			) : (
				<div className="grid min-h-0 flex-1 overflow-hidden border-t border-outline-variant bg-surface pb-[68px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_390px]">
					<section className="flex min-w-0 min-h-0 flex-col p-4">
						<ItemSearch
							isLoading={items.isLoading}
							value={itemSearchQuery}
							onChange={setItemSearchQuery}
						/>
						<div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
							<ItemGrid
								currency={bootstrap.data?.currency}
								hideImages={bootstrap.data?.hide_images}
								isLoading={items.isLoading}
								items={items.items}
								mutationDisabled={cartIsMutating}
								onAddItem={handleAddItem}
							/>
						</div>
					</section>
					<CartPanel
						className="hidden xl:flex"
						allowDiscountChange={bootstrap.data?.allow_discount_change}
						allowRateChange={bootstrap.data?.allow_rate_change}
						currency={bootstrap.data?.currency}
						warehouse={bootstrap.data?.warehouse}
						isOnline={isReachable && navigator.onLine !== false}
						onCheckout={handleOpenCheckout}
						onClearCustomer={() => setSelectedCustomer(null)}
						onClearCart={() => handleClearCart(false)}
						onHold={handleHoldCart}
						onLoadBatches={cartActions.loadItemBatches}
						onRemoveItem={cartActions.removeCartItem}
						onSelectCustomer={setSelectedCustomer}
						onUpdateQty={cartActions.updateCartItemQty}
						onUpdatePricing={cartActions.updateCartItemPricing}
						onUpdateNote={cartActions.updateCartItemNote}
						onUpdateBatchAllocations={cartActions.updateCartItemBatchAllocations}
						onUpdateUom={cartActions.updateCartItemUom}
						onUpdateSerialAllocations={cartActions.updateCartItemSerialAllocations}
					/>
				</div>
			)}

			{activePage === "Home" ? <button
				type="button"
				className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-md xl:hidden"
				onClick={() => setIsCartOpen(true)}
				aria-label="Open cart"
			>
				<ShoppingCart className="size-6" />
				{cartInvoice?.items?.length ? (
					<span className="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-error px-1 text-xs font-semibold text-on-error">
						{cartInvoice.items.length}
					</span>
				) : null}
			</button> : null}

			{isCartOpen ? (
				<div className="fixed inset-0 z-50 xl:hidden">
					<button
						type="button"
						className="absolute inset-0 bg-black/30"
						onClick={() => setIsCartOpen(false)}
						aria-label="Close cart"
					/>
					<div className="absolute bottom-0 right-0 top-0 flex w-[min(92vw,26rem)] flex-col border-l border-outline-variant bg-surface shadow-lg">
						<div className="flex h-12 shrink-0 items-center justify-between border-b border-outline-variant px-4">
							<div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
								<ShoppingCart className="size-4 text-primary" />
								Cart
							</div>
							<button
								type="button"
								className="flex h-touch w-touch items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
								onClick={() => setIsCartOpen(false)}
								aria-label="Close cart"
							>
								<X className="size-5" />
							</button>
						</div>
						<CartPanel
							className="flex-1 border-0"
							allowDiscountChange={bootstrap.data?.allow_discount_change}
							allowRateChange={bootstrap.data?.allow_rate_change}
							currency={bootstrap.data?.currency}
							warehouse={bootstrap.data?.warehouse}
							isOnline={isReachable && navigator.onLine !== false}
							onCheckout={handleOpenCheckout}
							onClearCustomer={() => setSelectedCustomer(null)}
							onClearCart={() => handleClearCart(false)}
							onHold={handleHoldCart}
							onLoadBatches={cartActions.loadItemBatches}
							onRemoveItem={cartActions.removeCartItem}
							onSelectCustomer={setSelectedCustomer}
							onUpdateQty={cartActions.updateCartItemQty}
							onUpdatePricing={cartActions.updateCartItemPricing}
							onUpdateNote={cartActions.updateCartItemNote}
							onUpdateBatchAllocations={cartActions.updateCartItemBatchAllocations}
							onUpdateUom={cartActions.updateCartItemUom}
							onUpdateSerialAllocations={cartActions.updateCartItemSerialAllocations}
						/>
					</div>
				</div>
			) : null}

			<CheckoutDialog
				allowPartialPayment={bootstrap.data?.allow_partial_payment}
				currency={bootstrap.data?.currency}
				currencyPrecision={bootstrap.data?.currency_precision}
				error={pageError}
				isOpen={isCheckoutOpen}
				modesOfPayment={paymentModes}
				onClear={() => {
					if (handleClearCart(true)) setIsCheckoutOpen(false);
				}}
				onClose={() => setIsCheckoutOpen(false)}
				onConfirm={handleCheckout}
				onHold={() => {
					void handleHoldCart().then((held) => {
						if (held) setIsCheckoutOpen(false);
					});
				}}
			/>

			{toast?.type === "submitted" && toast.invoice.docstatus === 1 ? (
				<div
					role="status"
					className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-secondary bg-secondary-container px-4 py-3 text-sm text-on-secondary-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
				>
					Invoice {toast.invoice.name} submitted for {getInvoiceTotal(toast.invoice).toFixed(2)}.
				</div>
			) : null}

			{toast?.type === "held" && toast.invoice.docstatus === 0 ? (
				<div
					role="status"
					className={`fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
				>
					Invoice {toast.invoice.name} held as draft.
				</div>
			) : null}

			{toast?.type === "error" ? (
				<div
					role="alert"
					className={`fixed inset-x-0 top-4 z-[60] mx-auto flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container shadow-md ${toastClosing ? "animate-toast-rise-out" : "animate-toast-drop-in"}`}
				>
					<span className="min-w-0 flex-1">{toast.message}</span>
					<button type="button" className="shrink-0 rounded p-0.5 hover:bg-error/10" onClick={clearToast} aria-label="Dismiss error">
						<X className="size-4" />
					</button>
				</div>
			) : null}

			<ConfirmDialog
				isOpen={Boolean(clearCartConfirmation)}
				title="Clear the current cart?"
				description="Every item, quantity, payment allocation, batch or serial selection, discount, and note in this cart will be removed."
				confirmLabel="Clear Cart"
				danger
				onCancel={() => setClearCartConfirmation(null)}
				onConfirm={confirmClearCart}
			>
				<div className="flex justify-between gap-3 text-sm"><span className="text-on-surface-variant">Items in cart</span><strong>{cartInvoice?.items?.length || 0}</strong></div>
			</ConfirmDialog>
		</div>
	);
}
