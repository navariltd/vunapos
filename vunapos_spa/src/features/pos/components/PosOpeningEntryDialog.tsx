import { useMemo, useState } from "react";
import { AlertCircle, Banknote, CheckCircle2, CreditCard, Wallet } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import type { ModeOfPaymentDTO, POSProfileOptionDTO } from "../types";

type PaymentMethod = ModeOfPaymentDTO & { type: "Cash" | "Bank" | "General" };

function classifyPaymentMode(modeOfPayment: string): PaymentMethod["type"] {
	const name = modeOfPayment.toLowerCase();
	if (name.includes("cash")) {
		return "Cash";
	}
	if (name.includes("bank")) {
		return "Bank";
	}
	return "General";
}

function paymentIcon(type: PaymentMethod["type"]) {
	switch (type) {
		case "Cash":
			return <Banknote className="size-5 text-secondary" aria-hidden="true" />;
		case "Bank":
			return <CreditCard className="size-5 text-primary" aria-hidden="true" />;
		default:
			return <Wallet className="size-5 text-on-surface-variant" aria-hidden="true" />;
	}
}

type PosOpeningEntryDialogProps = {
	posProfile: string;
	profiles: POSProfileOptionDTO[];
	onPosProfileChange: (profile: string) => Promise<void>;
	profileSwitching?: boolean;
	modesOfPayment: ModeOfPaymentDTO[];
	onSuccess: () => void;
};

// Ported from feat/pos-opening-entry-bootstrap-flow's PosOpenningEntryDialog.tsx.
// Dropped: its own posProfileStore.ts/modesOfPaymentStore.ts (both called the raw
// browser fetch API directly, bypassing this app's CSRF/response-envelope handling,
// and duplicated bootstrap data). The profile picker now uses the permission-filtered
// server list and rehydrates the active server-backed catalogue when changed. Kept:
// the per-payment-mode opening balance form and the create flow,
// now going through useFrappePostCall like every other mutation in this app. No
// cancel/dismiss - opening a session is a genuine requirement, not optional, same as
// BootstrapGate's hard block has no bypass either.
export function PosOpeningEntryDialog({
	posProfile,
	profiles,
	onPosProfileChange,
	profileSwitching = false,
	modesOfPayment,
	onSuccess,
}: PosOpeningEntryDialogProps) {
	const [step, setStep] = useState<"form" | "creating" | "success">("form");
	const [error, setError] = useState("");
	const [openingAmounts, setOpeningAmounts] = useState<Record<string, string>>({});
	const createCall = useFrappePostCall("vunapos.api.pos_entry.create_opening_entry");

	const paymentMethods = useMemo<PaymentMethod[]>(
		() => modesOfPayment.map((mode) => ({ ...mode, type: classifyPaymentMode(mode.mode_of_payment) })),
		[modesOfPayment],
	);

	async function handleProfileChange(profile: string) {
		setOpeningAmounts({});
		setError("");
		try {
			await onPosProfileChange(profile);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load the selected POS Profile");
		}
	}

	async function handleCreate() {
		if (!paymentMethods.length) {
			setError("No payment modes are configured for this POS Profile.");
			return;
		}
		setError("");
		setStep("creating");
		try {
			const openingBalance = paymentMethods.map((method) => ({
				mode_of_payment: method.mode_of_payment,
				opening_amount: Number(openingAmounts[method.mode_of_payment] || 0),
			}));
			await createCall.call({ pos_profile: posProfile, opening_balance: openingBalance });
			setStep("success");
			window.setTimeout(onSuccess, 1000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create POS opening entry");
			setStep("form");
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div className="w-full max-w-xl rounded-xl border border-outline-variant bg-surface shadow-xl">
				<div className="border-b border-outline-variant px-6 py-4">
					<h2 className="text-lg font-semibold text-on-surface">POS Opening Entry</h2>
					<p className="mt-1 text-sm text-on-surface-variant">
						Declare your opening cash float for {posProfile} before you start selling.
					</p>
				</div>

				<div className="p-6">
					{step === "form" ? (
						<div className="space-y-6">
							{profiles.length > 1 ? (
								<label className="block space-y-2">
									<span className="text-sm font-medium text-on-surface">POS Profile</span>
									<select
										value={posProfile}
										disabled={profileSwitching || createCall.loading}
										onChange={(event) => void handleProfileChange(event.target.value)}
										className="w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
									>
										{profiles.map((profile) => (
											<option key={profile.name} value={profile.name}>
												{profile.name}{profile.warehouse ? ` — ${profile.warehouse}` : ""}
											</option>
										))}
									</select>
									{profileSwitching ? (
										<span className="text-xs text-on-surface-variant">Loading the selected profile...</span>
									) : null}
								</label>
							) : null}
							<div className="space-y-3">
								{paymentMethods.length ? (
									paymentMethods.map((method) => (
										<div
											key={method.mode_of_payment}
											className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low p-3"
										>
											{paymentIcon(method.type)}
											<div className="flex-1">
												<p className="text-sm font-medium text-on-surface">{method.mode_of_payment}</p>
												<p className="text-xs text-on-surface-variant">{method.type}</p>
											</div>
											<input
												type="number"
												min="0"
												placeholder="0.00"
												value={openingAmounts[method.mode_of_payment] ?? ""}
												onChange={(event) =>
													setOpeningAmounts((prev) => ({
														...prev,
														[method.mode_of_payment]: event.target.value,
													}))
												}
												className="w-24 rounded-md border border-outline-variant bg-surface px-2 py-1 text-sm text-on-surface"
											/>
										</div>
									))
								) : (
									<p className="rounded-md bg-surface-container-low p-3 text-sm text-on-surface-variant">
										Loading configured payment modes...
									</p>
								)}
							</div>

							{error ? (
								<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
									<AlertCircle className="size-4 shrink-0" aria-hidden="true" />
									{error}
								</div>
							) : null}

							<Button className="w-full" disabled={!paymentMethods.length || createCall.loading || profileSwitching} onClick={handleCreate}>
								{createCall.loading ? "Starting..." : "Start POS Session"}
							</Button>
						</div>
					) : null}

					{step === "creating" ? (
						<div className="py-10 text-center text-sm text-on-surface-variant">Creating POS session...</div>
					) : null}

					{step === "success" ? (
						<div className="py-10 text-center">
							<CheckCircle2 className="mx-auto size-10 text-secondary" aria-hidden="true" />
							<h3 className="mt-3 text-sm font-semibold text-on-surface">POS session started</h3>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
