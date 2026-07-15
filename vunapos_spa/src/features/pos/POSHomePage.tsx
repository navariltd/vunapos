import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, ShoppingCart, X } from "lucide-react";

import type { CustomerDTO, HeldInvoiceDTO, InvoiceDTO, ItemDTO, PaymentInput, PrintPayload } from "./types";
import { getInvoiceTotal, getPaymentModes, normalizeDefaultCustomer } from "./utils";
import { Button } from "../../components/ui/Button";
import { VunaApiError } from "../../services/vunaApi";
import { CartPanel } from "./components/CartPanel";
import { CheckoutDialog } from "./components/CheckoutDialog";
import { HeldInvoicesPanel } from "./components/HeldInvoicesPanel";
import { ItemGrid } from "./components/ItemGrid";
import { ItemSearch } from "./components/ItemSearch";
import { useBootstrapData } from "./hooks/useBootstrapData";
import { useItemSearch } from "./hooks/useItemSearch";
import { usePOSInvoice } from "./hooks/usePOSInvoice";
import { useModesOfPaymentStore } from "../../store/modesOfPaymentStore";
import { usePOSProfileStore } from "../../store/posProfileStore";

import  POSOpeningEntryModal  from "../../components/PosOpenningEntryDialog";

type POSHomePageProps = {
	bootstrap?: ReturnType<typeof useBootstrapData>;
};

type POSPage = "Home" | "Invoices" | "Payments" | "Customers" | "Close Shift";

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

function isMissingPOSProfileError(error: unknown) {
	if (!error) {
		return false;
	}

	const message =
		error instanceof Error
			? error.message
			: typeof error === "object" && "message" in error
				? String(error.message)
				: String(error);

	return (
		message.includes("No POS Profile assigned to user") ||
		message.includes("No POS Profile has been assigned to your account")
	);
}

function POSSetupRequiredDialog({ message }: { message: string }) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="pos-setup-required-title"
				className="w-full max-w-md rounded-xl border border-error bg-surface p-6 shadow-xl"
			>
				<div className="flex items-start gap-3">
					<CircleAlert className="mt-0.5 size-6 shrink-0 text-error" aria-hidden="true" />
					<div>
						<h2 id="pos-setup-required-title" className="text-lg font-semibold text-on-surface">
							POS setup required
						</h2>
						<p className="mt-2 text-sm text-on-surface-variant">{message}</p>
						<p className="mt-4 text-sm font-medium text-on-surface">
							Please contact your administrator to assign a POS Profile to your account.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

export function POSHomePage({ bootstrap: providedBootstrap }: POSHomePageProps) {
	 const getUserFriendlyError = (error: unknown): string => {
	if (!error) {
		return "";
	}

	const message =
		error instanceof VunaApiError
			? error.message
			: error instanceof Error
				? error.message
				: typeof error === "object" && "message" in error
					? String(error.message)
					: String(error);

	if (
		message.includes("No POS Profile assigned to user") ||
		message.includes("No POS Profile")
	) {
		return "No POS Profile has been assigned to your account. Please contact your administrator to complete your POS setup.";
	}

	return message || "An unexpected error occurred. Please contact your administrator.";
};
	const [showOpeningModal, setShowOpeningModal] = useState(false);
	const [itemSearchQuery, setItemSearchQuery] = useState("");
	const [selectedCustomer, setSelectedCustomer] = useState<CustomerDTO | null | undefined>(undefined);
	const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
	const [isCartOpen, setIsCartOpen] = useState(false);
	const [activePage, setActivePage] = useState<POSPage>("Home");
	const [pageError, setPageError] = useState<string | null>(null);
	const [lastSubmittedInvoice, setLastSubmittedInvoice] = useState<InvoiceDTO | null>(null);
	const [lastHeldInvoice, setLastHeldInvoice] = useState<InvoiceDTO | null>(null);

	const ownBootstrap = useBootstrapData();
	const bootstrap = providedBootstrap || ownBootstrap;
	const storedPosProfile = usePOSProfileStore((state) => state.posDetails?.name);
	const storedModesOfPayment = useModesOfPaymentStore((state) => state.modesOfPayment);
	const storedModesPosProfile = useModesOfPaymentStore((state) => state.posProfile);
	const setStoredModesOfPayment = useModesOfPaymentStore((state) => state.setModesOfPayment);

	useEffect(() => {
		const posProfile = bootstrap.data?.pos_profile;
		setStoredModesOfPayment(posProfile, getPaymentModes(bootstrap.data));
	}, [bootstrap.data, setStoredModesOfPayment]);
	
	const defaultCustomer = useMemo(
	() => normalizeDefaultCustomer(bootstrap.data ?? {}),
	[bootstrap.data]
);

	const posProfile = storedPosProfile ?? bootstrap.data?.pos_profile;
	const paymentModes = useMemo(
		() =>
			storedModesPosProfile === posProfile
				? storedModesOfPayment
				: getPaymentModes(bootstrap.data ?? {}),
		[bootstrap.data, posProfile, storedModesOfPayment, storedModesPosProfile],
	);

	const activeCustomer = selectedCustomer === undefined ? defaultCustomer : selectedCustomer;

const isPOSReady =
	bootstrap.data?.session?.ready === true &&
	bootstrap.data?.session?.status === "OPEN";


const items = useItemSearch(
	itemSearchQuery,
	posProfile ?? undefined,
	activeCustomer?.customer,
	isPOSReady,
);


const invoice = usePOSInvoice({
	posProfile: isPOSReady ? posProfile ?? undefined : undefined,
	selectedCustomer: isPOSReady ? activeCustomer : null,
});
	const listHeldInvoices = invoice.listHeld;
	const restoreHeldInvoice = invoice.restoreHeldInvoice;

const error = pageError
	? getUserFriendlyError(pageError)
	: bootstrap.error
		? getUserFriendlyError(bootstrap.error)
		: items.error
			? getUserFriendlyError(items.error)
			: invoice.error
				? getUserFriendlyError(invoice.error)
				: null;
	useEffect(() => {
		if (!lastSubmittedInvoice && !lastHeldInvoice) {
			return undefined;
		}

		const timeout = window.setTimeout(() => {
			setLastSubmittedInvoice(null);
			setLastHeldInvoice(null);
		}, 5000);

		return () => window.clearTimeout(timeout);
	}, [lastHeldInvoice, lastSubmittedInvoice]);
	const requiresPOSSetup = [pageError, bootstrap.error, items.error, invoice.error, error].some(
		isMissingPOSProfileError,
	);
	
	useEffect(() => {
		if (!isPOSReady) {
			return;
		}

		listHeldInvoices().catch((err) => {
			setPageError(err instanceof Error ? err.message : "Failed to load held invoices");
		});
	}, [isPOSReady, listHeldInvoices]);

	const handleAddItem = async (item: ItemDTO) => {
		setPageError(null);
		setLastSubmittedInvoice(null);
		try {
			await invoice.addCartItem(item);
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to add item");
		}
	};

	const handleOpenCheckout = async () => {
		setPageError(null);
		setIsCartOpen(false);
		setIsCheckoutOpen(true);
	};

	const handleHoldCart = async () => {
		setPageError(null);
		setLastSubmittedInvoice(null);
		setLastHeldInvoice(null);
		try {
			const heldInvoice = await invoice.holdCart();
			if (heldInvoice) {
				setLastHeldInvoice(heldInvoice);
				setSelectedCustomer(undefined);
				setIsCartOpen(false);
			}
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to hold invoice");
		}
	};

	const handleRefreshHeld = useCallback(async () => {
		setPageError(null);
		try {
			await listHeldInvoices();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to load held invoices");
		}
	}, [listHeldInvoices]);
	useEffect(() => {
	const session = bootstrap.data?.session;

	if (!bootstrap.data?.pos_profile) {
		setShowOpeningModal(false);
		return;
	}

	if (!session?.ready) {
		// POS profile exists but no opening entry
		setShowOpeningModal(true);
		return;
	}

	setShowOpeningModal(session.status !== "OPEN");

}, [
	bootstrap.data?.pos_profile,
	bootstrap.data?.session
]);
	useEffect(() => {
		const handleNavigation = (event: Event) => {
			const page = (event as CustomEvent<{ page?: POSPage }>).detail?.page;
			if (!page) {
				return;
			}

			setActivePage(page);
			if (page === "Invoices") {
				handleRefreshHeld();
			}
		};

		window.addEventListener("vunapos_nav", handleNavigation);
		return () => window.removeEventListener("vunapos_nav", handleNavigation);
	}, [handleRefreshHeld]);

	const handleRestoreHeld = async (heldInvoice: HeldInvoiceDTO) => {
		setPageError(null);
		setLastSubmittedInvoice(null);
		setLastHeldInvoice(null);
		try {
			const restoredInvoice = await restoreHeldInvoice(heldInvoice);
			setSelectedCustomer(
				restoredInvoice.customer
					? {
							customer: restoredInvoice.customer,
							customer_name: restoredInvoice.customer_name || restoredInvoice.customer,
						}
					: null,
			);
			setActivePage("Home");
			window.dispatchEvent(new CustomEvent("vunapos_nav", { detail: { page: "Home" } }));
			setIsCartOpen(true);
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to restore held invoice");
		}
	};
console.log("POS DEBUG", {
	bootstrap: bootstrap.data,
	items: items.items,
	paymentModes,
	invoice: invoice.invoice,
	error
});
	const handleCheckout = async (payments: PaymentInput[], idempotencyKey: string) => {
		setPageError(null);
		try {
			const result = await invoice.submitCart(payments, bootstrap.data?.print_format, idempotencyKey);
			setIsCheckoutOpen(false);
			setSelectedCustomer(undefined);
			setLastSubmittedInvoice(result?.invoice || null);
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




if (requiresPOSSetup) {
	return <POSSetupRequiredDialog message={getUserFriendlyError(error || bootstrap.error)} />;
}


if (!isPOSReady && bootstrap.data?.pos_profile) {
	return (
		<POSOpeningEntryModal
			isOpen={showOpeningModal}
			onClose={() => {}}
			onSuccess={() => {
				window.location.reload();
			}}
		/>
	);
}
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
	{error ? (
	<div className="mx-4 mb-3 mt-4 shrink-0 rounded-md border border-error bg-error-container px-4 py-3 text-sm text-on-error-container">
		<p className="font-semibold">
			POS Setup Required
		</p>

		<p className="mt-1">
			{error}
		</p>
	</div>
) : null}

			{activePage === "Invoices" ? (
				<section className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-lg font-semibold text-on-surface">Invoices</h2>
								<p className="text-sm text-on-surface-variant">Restore held draft sales when the customer is ready.</p>
							</div>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setActivePage("Home");
									window.dispatchEvent(new CustomEvent("vunapos_nav", { detail: { page: "Home" } }));
								}}
							>
								Back to POS
							</Button>
						</div>
						<HeldInvoicesPanel
							currency={bootstrap.data?.currency}
							heldInvoices={invoice.heldInvoices ?? []}
							isLoading={invoice.isHeldLoading}
							onRefresh={handleRefreshHeld}
							onRestore={handleRestoreHeld}
						/>
					</div>
				</section>
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
								isLoading={items.isLoading}
								items={items.items ?? []}
								mutationDisabled={invoice.isMutating}
								onAddItem={handleAddItem}
							/>
						</div>
					</section>
					<CartPanel
						className="hidden xl:flex"
						currency={bootstrap.data?.currency}
						invoice={invoice.invoice}
						isMutating={invoice.isMutating}
						selectedCustomer={activeCustomer}
						onCheckout={handleOpenCheckout}
						onClearCustomer={() => setSelectedCustomer(null)}
						onClearCart={invoice.clearCart}
						onHold={handleHoldCart}
						onRemoveItem={invoice.removeCartItem}
						onSelectCustomer={setSelectedCustomer}
						onUpdateQty={invoice.updateCartItemQty}
					/>
				</div>
			)}

			<button
				type="button"
				className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-md xl:hidden"
				onClick={() => setIsCartOpen(true)}
				aria-label="Open cart"
			>
				<ShoppingCart className="size-6" />
				{invoice.invoice?.items?.length ? (
					<span className="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-error px-1 text-xs font-semibold text-on-error">
						{invoice.invoice.items?.length}
					</span>
				) : null}
			</button>

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
							currency={bootstrap.data?.currency}
							invoice={invoice?.invoice}
							isMutating={invoice.isMutating}
							selectedCustomer={activeCustomer}
							onCheckout={handleOpenCheckout}
							onClearCustomer={() => setSelectedCustomer(null)}
							onClearCart={invoice.clearCart}
							onHold={handleHoldCart}
							onRemoveItem={invoice.removeCartItem}
							onSelectCustomer={setSelectedCustomer}
							onUpdateQty={invoice.updateCartItemQty}
						/>
					</div>
				</div>
			) : null}


			<CheckoutDialog
				currency={bootstrap.data?.currency}
				invoice={invoice.invoice}
				isOpen={isCheckoutOpen}
				isSubmitting={invoice.isMutating}
				modesOfPayment={paymentModes}
				onClose={() => setIsCheckoutOpen(false)}
				onConfirm={handleCheckout}
			/>

			{lastSubmittedInvoice?.docstatus === 1 ? (
				<div
					role="status"
					className="fixed right-4 top-16 z-40 max-w-sm rounded-md border border-secondary bg-secondary-container px-4 py-3 text-sm text-on-secondary-container shadow-md"
				>
					Invoice {lastSubmittedInvoice.name} submitted for {getInvoiceTotal(lastSubmittedInvoice).toFixed(2)}.
				</div>
			) : null}

			{lastHeldInvoice?.docstatus === 0 ? (
				<div
					role="status"
					className="fixed right-4 top-16 z-40 max-w-sm rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface shadow-md"
				>
					Invoice {lastHeldInvoice.name} held as draft.
				</div>
			) : null}
		</div>
	);
}
