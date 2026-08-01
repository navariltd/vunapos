import { useMemo, useRef, useState } from "react";
import { AlertCircle, Award, Check, Loader2, Pause, RefreshCw, Smartphone, Trash2, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { useGatewayPaymentRealtime } from "../hooks/useGatewayPaymentRealtime";
import {
	allocateAllToMode,
	buildPaymentInputs,
	canCompletePaymentAllocation,
	calculatePaymentAllocation,
	createInitialPaymentAmounts,
	currencyScale,
	minorUnitsToInput,
	normalizeCurrencyPrecision,
	parsePaymentAmount,
	totalToMinorUnits,
} from "../paymentAllocation";
import { useCartStore } from "../stores/cartStore";
import type {
	CustomerDTO,
	CustomerLoyaltyDTO,
	GatewayPaymentLinkDTO,
	InvoiceDTO,
	ModeOfPaymentDTO,
	PaymentInput,
} from "../types";
import { formatCurrency, getInvoiceTotal } from "../utils";

type CheckoutDialogProps = {
	allowCreditSales?: boolean;
	allowPartialPayment?: boolean;
	currency?: string;
	currencyPrecision?: number;
	customer?: CustomerDTO | null;
	customerLoyalty?: CustomerLoyaltyDTO | null;
	defaultSaleType?: "Cash Sale" | "Credit Sale";
	error?: string | null;
	isOpen: boolean;
	modesOfPayment: ModeOfPaymentDTO[];
	onClear: () => void;
	onClose: () => void;
	onConfirm: (
		payments: PaymentInput[],
		idempotencyKey: string,
		isCreditSale: boolean,
		dueDate?: string,
		loyaltyPoints?: number,
		taxId?: string,
	) => void;
	onHold: () => void;
	onAttachC2bGatewayPayment?: (params: {
		mode_of_payment: string;
		transaction_reference: string;
		amount: number;
		idempotency_key: string;
	}) => Promise<GatewayPaymentLinkDTO>;
	onCheckGatewayPayment?: (gatewayPaymentLink: string) => Promise<GatewayPaymentLinkDTO>;
	onCancelGatewayPayment?: (gatewayPaymentLink: string) => Promise<GatewayPaymentLinkDTO>;
	onInitiateGatewayPayment?: (params: {
		mode_of_payment: string;
		amount: number;
		phone_number: string;
		idempotency_key: string;
	}) => Promise<GatewayPaymentLinkDTO>;
	onPreviewLoyalty: (loyaltyPoints: number) => Promise<InvoiceDTO | null>;
	orderType?: "Sales Invoice" | "Sales Order";
	posProfile?: string;
};

function createIdempotencyKey() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayInputValue() {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function CheckoutDialog({
	allowCreditSales,
	allowPartialPayment,
	currency,
	currencyPrecision,
	customer,
	customerLoyalty,
	defaultSaleType,
	error,
	isOpen,
	modesOfPayment,
	onClear,
	onClose,
	onConfirm,
	onHold,
	onAttachC2bGatewayPayment,
	onCheckGatewayPayment,
	onCancelGatewayPayment,
	onInitiateGatewayPayment,
	onPreviewLoyalty,
	orderType = "Sales Invoice",
	posProfile,
}: CheckoutDialogProps) {
	if (!isOpen) {
		return null;
	}

	return (
		<CheckoutDialogContent
			key={allowCreditSales ? "credit-enabled" : "credit-disabled"}
			allowCreditSales={allowCreditSales}
			allowPartialPayment={allowPartialPayment}
			currency={currency}
			currencyPrecision={currencyPrecision}
			customer={customer}
			customerLoyalty={customerLoyalty}
			defaultSaleType={defaultSaleType}
			error={error}
			modesOfPayment={modesOfPayment}
			onClear={onClear}
			onClose={onClose}
			onConfirm={onConfirm}
			onHold={onHold}
			onAttachC2bGatewayPayment={onAttachC2bGatewayPayment}
			onCheckGatewayPayment={onCheckGatewayPayment}
			onCancelGatewayPayment={onCancelGatewayPayment}
			onInitiateGatewayPayment={onInitiateGatewayPayment}
			onPreviewLoyalty={onPreviewLoyalty}
			orderType={orderType}
			posProfile={posProfile}
		/>
	);
}

function CheckoutDialogContent({
	allowCreditSales,
	allowPartialPayment,
	currency,
	currencyPrecision,
	customer,
	customerLoyalty,
	defaultSaleType,
	error,
	modesOfPayment,
	onClear,
	onClose,
	onConfirm,
	onHold,
	onAttachC2bGatewayPayment,
	onCheckGatewayPayment,
	onCancelGatewayPayment,
	onInitiateGatewayPayment,
	onPreviewLoyalty,
	orderType = "Sales Invoice",
	posProfile,
}: Omit<CheckoutDialogProps, "isOpen">) {
	const invoice = useCartStore((s) => s.invoice);
	const isSubmitting = useCartStore((s) => s.isMutating);
	const isSalesOrder = orderType === "Sales Order";
	const total = getInvoiceTotal(invoice);
	const precision = normalizeCurrencyPrecision(currencyPrecision ?? 2);
	const availableModes = useMemo(
		() => Array.from(new Map(modesOfPayment.map((mode) => [mode.mode_of_payment, mode])).values()),
		[modesOfPayment],
	);
	const scale = currencyScale(precision);
	const totalMinor = totalToMinorUnits(total, precision);
	const loyaltyFactor = Number(customerLoyalty?.conversion_factor || 0);
	const availableLoyaltyPoints = Math.max(Math.floor(Number(customerLoyalty?.points || 0)), 0);
	const maximumLoyaltyPoints = loyaltyFactor > 0
		? Math.min(availableLoyaltyPoints, Math.floor(total / loyaltyFactor))
		: 0;
	const [loyaltyInput, setLoyaltyInput] = useState("");
	const [appliedLoyaltyPoints, setAppliedLoyaltyPoints] = useState(
		Math.min(Math.floor(Number(invoice?.loyalty_points || 0)), maximumLoyaltyPoints),
	);
	const [appliedLoyaltyAmount, setAppliedLoyaltyAmount] = useState(Number(invoice?.loyalty_amount || 0));
	const [loyaltyError, setLoyaltyError] = useState("");
	const [isApplyingLoyalty, setIsApplyingLoyalty] = useState(false);
	const loyaltyAmountMinor = totalToMinorUnits(appliedLoyaltyAmount, precision);
	const payableMinor = Math.max(totalMinor - loyaltyAmountMinor, 0);
	const [amounts, setAmounts] = useState(() =>
		allowCreditSales && defaultSaleType === "Credit Sale"
			? Object.fromEntries(availableModes.map((mode) => [mode.mode_of_payment, ""]))
			: createInitialPaymentAmounts(availableModes, payableMinor, precision),
	);
	const [isCreditSale, setIsCreditSale] = useState(
		Boolean(allowCreditSales && (invoice?.is_credit_sale || defaultSaleType === "Credit Sale")),
	);
	const today = useMemo(() => todayInputValue(), []);
	const [dueDate, setDueDate] = useState(invoice?.due_date || today);
	const [checkoutTaxId, setCheckoutTaxId] = useState("");
	const [gatewayLinks, setGatewayLinks] = useState<Record<string, GatewayPaymentLinkDTO | undefined>>({});
	const [gatewayPhones, setGatewayPhones] = useState<Record<string, string>>({});
	const [gatewayReferences, setGatewayReferences] = useState<Record<string, string>>({});
	const [gatewayErrors, setGatewayErrors] = useState<Record<string, string | undefined>>({});
	const [gatewayBusy, setGatewayBusy] = useState<Record<string, string | undefined>>({});
	const idempotencyKey = useRef(createIdempotencyKey());
	const isWalkinCustomer = Boolean(customer?.is_walkin);
	const allocation = calculatePaymentAllocation(availableModes, amounts, payableMinor, precision);
	const hasUnverifiedGatewayPayment = availableModes.some((mode) => {
		if (!mode.payment_gateway) return false;
		const amountMinor = parsePaymentAmount(amounts[mode.mode_of_payment] || "", precision);
		if (!amountMinor || amountMinor <= 0) return false;
		return gatewayLinks[mode.mode_of_payment]?.status !== "Paid";
	});
	const hasNonCashOverpayment = allocation.nonCashMinor > payableMinor;
	const isLoyaltySelectionValid = appliedLoyaltyPoints <= maximumLoyaltyPoints;
	const isPayable = isSalesOrder || (!hasUnverifiedGatewayPayment && !isApplyingLoyalty && isLoyaltySelectionValid && (!isCreditSale || dueDate >= today) && (
		payableMinor === 0
			? !allocation.hasInvalidAmount && allocation.allocatedMinor === 0
			: availableModes.length > 0 && (isCreditSale
				? !allocation.hasInvalidAmount && !hasNonCashOverpayment
				: canCompletePaymentAllocation(allocation, payableMinor, Boolean(allowPartialPayment)))
	));
	const loyaltyInputPoints = /^\d+$/.test(loyaltyInput) ? Number(loyaltyInput) : null;
	const loyaltyInputError = loyaltyInput && (
		loyaltyInputPoints === null || loyaltyInputPoints <= 0 || loyaltyInputPoints > maximumLoyaltyPoints
	);
	const applyLoyaltyPoints = async (points: number) => {
		const normalizedPoints = Math.max(Math.min(Math.floor(points), maximumLoyaltyPoints), 0);
		setIsApplyingLoyalty(true);
		setLoyaltyError("");
		try {
			const preview = await onPreviewLoyalty(normalizedPoints);
			const validatedPoints = Math.floor(Number(preview?.loyalty_points || 0));
			const validatedAmount = Number(preview?.loyalty_amount || 0);
			const validatedTotalMinor = totalToMinorUnits(
				preview ? getInvoiceTotal(preview) : total,
				precision,
			);
			const nextPayableMinor = Math.max(validatedTotalMinor - totalToMinorUnits(validatedAmount, precision), 0);
			setAppliedLoyaltyPoints(validatedPoints);
			setAppliedLoyaltyAmount(validatedAmount);
			setLoyaltyInput(validatedPoints ? String(validatedPoints) : "");
			setAmounts(isCreditSale
				? Object.fromEntries(availableModes.map((mode) => [mode.mode_of_payment, ""]))
				: createInitialPaymentAmounts(availableModes, nextPayableMinor, precision));
		} catch (applyError) {
			setLoyaltyError(applyError instanceof Error ? applyError.message : "Unable to validate loyalty redemption");
		} finally {
			setIsApplyingLoyalty(false);
		}
	};
	const isOverpaid = allocation.remainingMinor < 0;
	const balanceLabel = isOverpaid
		? "Change"
		: isCreditSale || (allocation.remainingMinor > 0 && allowPartialPayment)
			? "Outstanding"
			: "Remaining";
	const balanceMinor = Math.abs(allocation.remainingMinor);
	const paymentStatus = allocation.hasInvalidAmount
		? "Invalid allocation"
		: allocation.remainingMinor < 0
			? "Change due"
			: allocation.remainingMinor === 0
				? "Fully paid"
				: isCreditSale && allocation.allocatedMinor > 0
					? "Deposit + credit"
					: isCreditSale
						? "Credit sale"
						: allowPartialPayment && allocation.allocatedMinor > 0
							? "Partial payment"
							: "Payment incomplete";

	const setPaidGatewayLink = (modeOfPayment: string, link: GatewayPaymentLinkDTO) => {
		setGatewayLinks((current) => ({ ...current, [modeOfPayment]: link }));
		setGatewayErrors((current) => ({ ...current, [modeOfPayment]: undefined }));
		if (link.status === "Paid") {
			setAmounts((current) => ({
				...current,
				[modeOfPayment]: minorUnitsToInput(totalToMinorUnits(Number(link.amount || 0), precision), precision),
			}));
		}
	};
	const gatewayRemainingMinor = (modeOfPayment: string) => {
		const currentModeMinor = parsePaymentAmount(amounts[modeOfPayment] || "", precision) || 0;
		return Math.max(payableMinor - allocation.allocatedMinor + currentModeMinor, 0);
	};
	const runGatewayAction = async (
		modeOfPayment: string,
		action: "stk" | "status" | "c2b" | "cancel",
		fn: () => Promise<GatewayPaymentLinkDTO>,
	) => {
		setGatewayBusy((current) => ({ ...current, [modeOfPayment]: action }));
		setGatewayErrors((current) => ({ ...current, [modeOfPayment]: undefined }));
		try {
			const link = await fn();
			setPaidGatewayLink(modeOfPayment, link);
		} catch (gatewayError) {
			setGatewayErrors((current) => ({
				...current,
				[modeOfPayment]: gatewayError instanceof Error ? gatewayError.message : "Gateway payment failed",
			}));
		} finally {
			setGatewayBusy((current) => ({ ...current, [modeOfPayment]: undefined }));
		}
	};
	const cancelGatewayLink = (modeOfPayment: string) => {
		const link = gatewayLinks[modeOfPayment];
		if (!link || !onCancelGatewayPayment) return;
		void runGatewayAction(modeOfPayment, "cancel", async () => {
			const cancelled = await onCancelGatewayPayment(link.name);
			setAmounts((current) => ({ ...current, [modeOfPayment]: "" }));
			return cancelled;
		});
	};
	useGatewayPaymentRealtime((event) => {
		const matchingMode = availableModes.find((mode) => {
			const currentLink = gatewayLinks[mode.mode_of_payment];
			return (
				currentLink?.name === event.name ||
				(currentLink?.source_doctype === event.source_doctype &&
					currentLink?.source_name === event.source_name)
			);
		});
		if (!matchingMode) return;
		if (event.pos_profile && posProfile && event.pos_profile !== posProfile) return;
		setPaidGatewayLink(matchingMode.mode_of_payment, event);
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-2 sm:p-4">
			<div className="flex h-[calc(100dvh-1rem)] max-h-[52rem] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-lg sm:h-[calc(100dvh-2rem)]">
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant px-4 py-4 sm:px-6">
					<div>
						<h2 className="text-lg font-semibold text-on-surface">Checkout</h2>
						<p className="text-sm text-on-surface-variant">
							{isSalesOrder ? "Sales Order" : "Invoice"} {invoice?.is_local ? "#Draft" : invoice?.name || "#Draft"}
						</p>
					</div>
					<button type="button" className="rounded-md p-2 hover:bg-surface-container" onClick={onClose}>
						<X className="size-5" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
					<div className="grid min-h-full lg:h-full lg:min-h-0 lg:grid-cols-2 lg:divide-x lg:divide-outline-variant">
					<section className="flex min-h-0 flex-col p-4 sm:p-6">
						{allowCreditSales && !isSalesOrder ? (
							<div className="mb-5 grid grid-cols-2 rounded-lg bg-surface-container p-1" role="group" aria-label="Sale type">
								{([false, true] as const).map((credit) => (
									<button
										type="button"
										key={String(credit)}
										aria-pressed={isCreditSale === credit}
										className={`rounded-md px-3 py-2 text-sm font-medium ${isCreditSale === credit ? "bg-surface text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
										onClick={() => {
											setIsCreditSale(credit);
											setAmounts(
												credit
													? Object.fromEntries(availableModes.map((mode) => [mode.mode_of_payment, ""]))
											: createInitialPaymentAmounts(availableModes, payableMinor, precision),
											);
										}}
									>
										{credit ? "Credit Sale" : "Cash Sale"}
									</button>
								))}
							</div>
						) : null}
						{isCreditSale ? (
							<label className="mb-5 block text-sm font-medium text-on-surface">
								Payment due date
								<input
									type="date"
									min={today}
									required
									value={dueDate}
									onChange={(event) => setDueDate(event.target.value)}
									className="mt-2 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
								/>
							</label>
						) : null}
						{isWalkinCustomer ? (
							<label className="mb-5 block text-sm font-medium text-on-surface">
								Customer Tax ID
								<input
									type="text"
									value={checkoutTaxId}
									onChange={(event) => setCheckoutTaxId(event.target.value)}
									maxLength={140}
									placeholder={customer?.tax_id || "PIN / Tax ID for this receipt"}
									className="mt-2 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
								/>
								<span className="mt-1 block text-xs font-normal text-on-surface-variant">
									This Tax ID will be printed on this invoice only.
								</span>
							</label>
						) : null}
						{customerLoyalty?.enrolled && !isSalesOrder ? (
							<div className="mb-5 rounded-md border border-tertiary/40 bg-tertiary-container/30 p-4">
								<div className="flex items-start gap-3">
									<Award className="mt-0.5 size-5 shrink-0 text-tertiary" />
									<div className="min-w-0 flex-1">
										<div className="flex justify-between gap-3">
											<div>
												<p className="text-sm font-semibold text-on-surface">Redeem loyalty points</p>
												<p className="text-xs text-on-surface-variant">{customerLoyalty.tier || customerLoyalty.program}</p>
											</div>
											<div className="text-right">
												<p className="text-sm font-semibold text-on-surface">{availableLoyaltyPoints.toLocaleString()} pts</p>
												<p className="text-xs text-on-surface-variant">{formatCurrency(customerLoyalty.redemption_value, currency, precision)}</p>
											</div>
										</div>
										<div className="mt-3 flex gap-2">
											<input
												aria-label="Loyalty points to redeem"
												className="h-touch min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-3 text-sm"
												inputMode="numeric"
												placeholder="Points to redeem"
												value={loyaltyInput}
												onChange={(event) => setLoyaltyInput(event.target.value)}
											/>
											<Button
												variant="ghost"
											disabled={!maximumLoyaltyPoints || isApplyingLoyalty}
											onClick={() => void applyLoyaltyPoints(maximumLoyaltyPoints)}
											>Maximum</Button>
											<Button
											disabled={Boolean(loyaltyInputError) || !loyaltyInputPoints || isApplyingLoyalty}
											onClick={() => void applyLoyaltyPoints(loyaltyInputPoints || 0)}
										>{isApplyingLoyalty ? "Checking..." : "Apply"}</Button>
										</div>
										{loyaltyInputError ? <p className="mt-2 text-xs text-error">Enter between 1 and {maximumLoyaltyPoints.toLocaleString()} points.</p> : null}
										{loyaltyError ? <p className="mt-2 text-xs text-error">{loyaltyError}</p> : null}
										{!isLoyaltySelectionValid ? <p className="mt-2 text-xs text-error">The available balance changed. Apply a valid number of points again.</p> : null}
										{appliedLoyaltyPoints ? (
											<div className="mt-3 flex items-center justify-between text-xs">
												<span className="text-on-surface-variant">Applied: {appliedLoyaltyPoints.toLocaleString()} points · {formatCurrency(loyaltyAmountMinor / scale, currency, precision)}</span>
												<button type="button" className="font-medium text-error" onClick={() => void applyLoyaltyPoints(0)}>Remove</button>
											</div>
										) : null}
									</div>
								</div>
							</div>
						) : null}
						<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Amount due</p>
						<p className="mt-1 text-3xl font-semibold text-on-surface">{formatCurrency(payableMinor / scale, currency, precision)}</p>
						{isSalesOrder ? (
							<div className="mt-6 rounded-md border border-outline-variant bg-surface-container-low p-4 text-sm text-on-surface-variant">
								This checkout will create a submitted Sales Order. No payment will be collected in this step.
							</div>
						) : (
							<>
								<div className="mt-6 max-h-64 min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
								{availableModes.map((mode) => {
									const isGatewayControlled = Boolean(mode.payment_gateway);
									const amount = amounts[mode.mode_of_payment] ?? "";
									const gatewayLink = gatewayLinks[mode.mode_of_payment];
									const gatewayAmountMinor = gatewayRemainingMinor(mode.mode_of_payment);
									const gatewayAmount = gatewayAmountMinor / scale;
									const gatewayBusyState = gatewayBusy[mode.mode_of_payment];
									const gatewayError = gatewayErrors[mode.mode_of_payment];
									const gatewayPaid = gatewayLink?.status === "Paid";
									const isAll =
										!isGatewayControlled &&
										parsePaymentAmount(amount, precision) === payableMinor &&
										availableModes.every(
											(other) =>
												other.mode_of_payment === mode.mode_of_payment ||
												parsePaymentAmount(amounts[other.mode_of_payment] || "", precision) === 0,
										);
									return (
										<div
											key={mode.mode_of_payment}
											className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low p-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto] sm:p-3"
										>
											<span className="col-span-2 text-sm font-medium text-on-surface sm:col-span-1">
												{mode.mode_of_payment}
												{mode.default ? <span className="ml-2 text-xs text-on-surface-variant">Default</span> : null}
												{isGatewayControlled ? <span className="ml-2 text-xs text-primary">Gateway</span> : null}
											</span>
											<input
												aria-label={`${mode.mode_of_payment} amount`}
												className="h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-right text-sm disabled:bg-surface-container disabled:text-on-surface-variant"
												inputMode="decimal"
												placeholder={isGatewayControlled ? "Use gateway" : minorUnitsToInput(0, precision)}
												value={amount}
												disabled={isGatewayControlled}
												onChange={(event) =>
													setAmounts((current) => ({
														...current,
														[mode.mode_of_payment]: event.target.value,
													}))
												}
											/>
											<button
												type="button"
												aria-label={`Allocate all to ${mode.mode_of_payment}`}
												aria-pressed={isAll}
												disabled={isGatewayControlled}
												title={isGatewayControlled
													? `${mode.mode_of_payment} requires gateway payment`
													: `Allocate the full amount to ${mode.mode_of_payment}`}
												className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-xs font-medium ${
													isAll
														? "bg-secondary text-on-secondary"
														: "bg-surface-container text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
												}`}
												onClick={() =>
													setAmounts(allocateAllToMode(availableModes, mode.mode_of_payment, payableMinor, precision))
												}
											>
												<Check className="size-4" />
											</button>
											{isGatewayControlled ? (
												<div className="col-span-2 space-y-2 rounded-md border border-outline-variant bg-surface p-3 sm:col-span-3">
													<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
														<span className="text-on-surface-variant">
															Gateway amount: {formatCurrency(gatewayAmount, currency, precision)}
														</span>
														<span className={gatewayPaid ? "font-medium text-secondary" : "text-on-surface-variant"}>
															{gatewayPaid
																? `Paid${gatewayLink?.transaction_reference ? ` · ${gatewayLink.transaction_reference}` : ""}`
																: gatewayLink
																	? `Status: ${gatewayLink.status}`
																	: "No verified payment"}
														</span>
													</div>
													<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
														<input
															aria-label={`${mode.mode_of_payment} phone number`}
															className="h-10 rounded-md border border-outline-variant bg-surface px-3 text-sm"
															inputMode="tel"
															placeholder="Phone number for STK"
															value={gatewayPhones[mode.mode_of_payment] || ""}
															onChange={(event) =>
																setGatewayPhones((current) => ({
																	...current,
																	[mode.mode_of_payment]: event.target.value,
																}))
															}
														/>
														<Button
															variant="ghost"
															className="h-10 gap-2"
															disabled={!posProfile || !gatewayAmountMinor || !onInitiateGatewayPayment || Boolean(gatewayBusyState)}
															onClick={() =>
																void runGatewayAction(mode.mode_of_payment, "stk", () =>
																	onInitiateGatewayPayment?.({
																		mode_of_payment: mode.mode_of_payment,
																		amount: gatewayAmount,
																		phone_number: gatewayPhones[mode.mode_of_payment] || "",
																		idempotency_key: `${idempotencyKey.current}:${mode.mode_of_payment}:stk`,
																	}) as Promise<GatewayPaymentLinkDTO>,
																)
															}
														>
															{gatewayBusyState === "stk"
																? <Loader2 className="size-4 animate-spin" />
																: <Smartphone className="size-4" />}
															STK
														</Button>
														<Button
															variant="ghost"
															className="h-10 gap-2"
															disabled={!gatewayLink || !onCheckGatewayPayment || Boolean(gatewayBusyState)}
															onClick={() =>
																void runGatewayAction(mode.mode_of_payment, "status", () =>
																	onCheckGatewayPayment?.(gatewayLink?.name || "") as Promise<GatewayPaymentLinkDTO>,
																)
															}
														>
															{gatewayBusyState === "status"
																? <Loader2 className="size-4 animate-spin" />
																: <RefreshCw className="size-4" />}
															Check
														</Button>
														<Button
															variant="ghost"
															className="h-10"
															disabled={!gatewayLink || gatewayPaid || !onCancelGatewayPayment || Boolean(gatewayBusyState)}
															onClick={() => cancelGatewayLink(mode.mode_of_payment)}
														>
															{gatewayBusyState === "cancel" ? "Cancelling..." : "Cancel"}
														</Button>
													</div>
													<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
														<input
															aria-label={`${mode.mode_of_payment} C2B transaction reference`}
															className="h-10 rounded-md border border-outline-variant bg-surface px-3 text-sm"
															placeholder="C2B transaction reference"
															value={gatewayReferences[mode.mode_of_payment] || ""}
															onChange={(event) =>
																setGatewayReferences((current) => ({
																	...current,
																	[mode.mode_of_payment]: event.target.value,
																}))
															}
														/>
														<Button
															variant="ghost"
															className="h-10"
															disabled={!posProfile || !gatewayAmountMinor || !onAttachC2bGatewayPayment || Boolean(gatewayBusyState)}
															onClick={() =>
																void runGatewayAction(mode.mode_of_payment, "c2b", () =>
																	onAttachC2bGatewayPayment?.({
																		mode_of_payment: mode.mode_of_payment,
																		transaction_reference: gatewayReferences[mode.mode_of_payment] || "",
																		amount: gatewayAmount,
																		idempotency_key: `${idempotencyKey.current}:${mode.mode_of_payment}:c2b:${gatewayReferences[mode.mode_of_payment] || ""}`,
																	}) as Promise<GatewayPaymentLinkDTO>,
																)
															}
														>
															{gatewayBusyState === "c2b" ? "Checking..." : "Attach C2B"}
														</Button>
													</div>
													{gatewayError ? <p className="text-xs text-error">{gatewayError}</p> : null}
												</div>
											) : null}
										</div>
									);
								})}
								</div>
								<div className="mt-5 grid gap-3 sm:grid-cols-3">
									<PaymentSummary label="Allocated" value={formatCurrency(allocation.allocatedMinor / scale, currency, precision)} />
									<PaymentSummary label={balanceLabel} value={formatCurrency(balanceMinor / scale, currency, precision)} invalid={allocation.hasInvalidAmount || hasNonCashOverpayment || (allocation.remainingMinor > 0 && !allowPartialPayment && !isCreditSale)} />
									<PaymentSummary label="Status" value={paymentStatus} invalid={!isPayable} compact />
								</div>
							</>
						)}
					{!isSalesOrder && allocation.hasInvalidAmount ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> Enter valid amounts with no more than {precision} decimal places.
						</div>
					) : null}
					{!isSalesOrder && hasNonCashOverpayment ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> Electronic payments cannot exceed the amount due.
						</div>
					) : null}
					{!isSalesOrder && hasUnverifiedGatewayPayment ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> Gateway payments must be verified before checkout.
						</div>
					) : null}
					{/* {allocation.remainingMinor > 0 && isCreditSale ? (
						<p className="text-sm text-on-surface-variant">
							The outstanding balance will remain on the customer's account. Add a payment above only when taking a deposit.
						</p>
					) : allocation.remainingMinor > 0 && allowPartialPayment ? (
						<p className="text-sm text-on-surface-variant">
							Partial payment is enabled.
						</p>
					) : null} */}
					{error ? (
						<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
							<AlertCircle className="size-4 shrink-0" /> {error}
						</div>
					) : null}
					</section>
					<InvoiceSummary
						invoice={invoice}
						currency={currency}
						precision={precision}
						allocatedMinor={isSalesOrder ? 0 : allocation.allocatedMinor}
						remainingMinor={isSalesOrder ? payableMinor : allocation.remainingMinor}
						loyaltyAmountMinor={isSalesOrder ? 0 : loyaltyAmountMinor}
					/>
					</div>
				</div>
				<div className="grid shrink-0 grid-cols-4 items-center gap-2 border-t border-outline-variant px-3 py-3 sm:flex sm:px-6">
					<Button variant="ghost" className="min-w-0 px-2 text-xs sm:px-3 sm:text-sm" onClick={onClose} disabled={isSubmitting}>Back</Button>
					<Button variant="danger" className="min-w-0 gap-1 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm" onClick={onClear} disabled={isSubmitting}>
						<Trash2 className="size-4" /> Clear
					</Button>
					<Button
						variant="ghost"
						className="min-w-0 gap-1 px-2 text-xs bg-tertiary text-on-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container sm:ml-auto sm:min-w-28 sm:gap-2 sm:px-3 sm:text-sm"
						onClick={onHold}
						disabled={isSubmitting || isSalesOrder}
						title={isSalesOrder ? "Holding Sales Orders is not supported yet" : undefined}
					>
						<Pause className="size-4" /> Hold
					</Button>
					<Button
						disabled={!isPayable || isSubmitting}
						onClick={() =>
							onConfirm(
								isSalesOrder ? [] : buildPaymentInputs(availableModes, amounts, precision).map((payment) => {
									const gatewayLink = gatewayLinks[payment.mode_of_payment];
									return gatewayLink?.status === "Paid"
										? { ...payment, gateway_payment_link: gatewayLink.name }
										: payment;
								}),
								idempotencyKey.current,
								isSalesOrder ? false : isCreditSale,
								isSalesOrder ? undefined : isCreditSale ? dueDate : undefined,
								isSalesOrder ? undefined : appliedLoyaltyPoints || undefined,
								isWalkinCustomer ? checkoutTaxId.trim() || undefined : undefined,
							)
						}
					>
						<span className="sm:hidden">{isSubmitting ? "..." : isSalesOrder ? "Order" : "Complete"}</span>
						<span className="hidden sm:inline">{isSubmitting ? "Submitting..." : isSalesOrder ? "Create Sales Order" : isCreditSale ? "Complete credit sale" : "Complete sale"}</span>
					</Button>
				</div>
			</div>
		</div>
	);
}

function InvoiceSummary({
	invoice,
	currency,
	precision,
	allocatedMinor,
	remainingMinor,
	loyaltyAmountMinor,
}: {
	invoice: ReturnType<typeof useCartStore.getState>["invoice"];
	currency?: string;
	precision: number;
	allocatedMinor: number;
	remainingMinor: number;
	loyaltyAmountMinor: number;
}) {
	const scale = currencyScale(precision);
	const taxes = invoice?.taxes || [];
	return (
		<section className="flex flex-col bg-surface-container-low p-4 sm:p-6 lg:min-h-0">
			<h3 className="font-semibold text-on-surface">Invoice summary</h3>
			<div className="mt-4">
				<p className="text-xs text-on-surface-variant">Customer</p>
				<p className="font-medium text-on-surface">{invoice?.customer_name || invoice?.customer || "Walk-in Customer"}</p>
			</div>
			<div className="mt-5 flex min-h-0 flex-1 flex-col">
				<p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Items</p>
				<div className="mt-2 max-h-56 min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
					{invoice?.items?.map((item) => (
						<div key={item.row_name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-sm">
							<span className="truncate text-on-surface">{item.item_name}</span>
							<span className="text-on-surface-variant">×{item.qty}</span>
							<span className="font-medium text-on-surface">{formatCurrency(item.amount, currency, precision)}</span>
						</div>
					))}
				</div>
			</div>
			<div className="mt-5 space-y-2 border-t border-outline-variant pt-4 text-sm">
				<SummaryRow label="Subtotal" value={formatCurrency(invoice?.totals.net_total, currency, precision)} />
				{taxes.map((tax, index) => (
					<SummaryRow key={`${tax.account_head || tax.description}-${index}`} label={`${tax.description || tax.account_head || "Tax"}${tax.rate ? ` ${tax.rate}%` : ""}`} value={formatCurrency(tax.tax_amount, currency, precision)} />
				))}
				<SummaryRow label="Grand total" value={formatCurrency(getInvoiceTotal(invoice), currency, precision)} strong />
				{loyaltyAmountMinor ? <SummaryRow label="Loyalty redemption" value={`−${formatCurrency(loyaltyAmountMinor / scale, currency, precision)}`} /> : null}
				{loyaltyAmountMinor ? <SummaryRow label="Amount payable" value={formatCurrency((totalToMinorUnits(getInvoiceTotal(invoice), precision) - loyaltyAmountMinor) / scale, currency, precision)} strong /> : null}
				<SummaryRow label="Paid" value={formatCurrency(allocatedMinor / scale, currency, precision)} />
				<SummaryRow label={remainingMinor < 0 ? "Change" : "Balance"} value={formatCurrency(Math.abs(remainingMinor) / scale, currency, precision)} strong />
			</div>
		</section>
	);
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
	return <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}><span>{label}</span><span className="text-on-surface">{value}</span></div>;
}

function PaymentSummary({
	label,
	value,
	invalid = false,
	compact = false,
}: {
	label: string;
	value: string;
	invalid?: boolean;
	compact?: boolean;
}) {
	return (
		<div className={`rounded-md p-3 ${invalid ? "bg-error-container" : "bg-surface-container-low"}`}>
			<p className={`text-xs ${invalid ? "text-on-error-container" : "text-on-surface-variant"}`}>{label}</p>
			<p className={`mt-1 whitespace-nowrap font-semibold ${compact ? "text-sm" : ""} ${invalid ? "text-on-error-container" : "text-on-surface"}`}>{value}</p>
		</div>
	);
}
