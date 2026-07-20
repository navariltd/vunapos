import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "../components/ui/Button";
import { PosOpeningEntryDialog } from "../features/pos/components/PosOpeningEntryDialog";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { usePosSessionStatus } from "../features/pos/hooks/usePosSessionStatus";
import { getPaymentModes } from "../features/pos/utils";
import { evaluateCachedPosSession } from "../lib/posSessionPolicy";
import { META_KEYS, metaRepository } from "../lib/repositories/metaRepository";
import type { CachedPosSession } from "../lib/types";

type PosOpeningGateProps = {
	children: React.ReactNode;
};

export function PosOpeningGate({ children }: PosOpeningGateProps) {
	const bootstrap = useBootstrapData();
	const posProfile = bootstrap.data?.pos_profile;
	const { session, isLoading, error } = usePosSessionStatus(posProfile);
	const cached = useLiveQuery(async () => ({
		session: await metaRepository.get<CachedPosSession>(META_KEYS.posSession),
		ttlHours: await metaRepository.get<number>(META_KEYS.offlineSessionTtlHours),
	}));
	const [, refreshExpiry] = useState(0);
	const cachedPolicy = useMemo(
		() =>
			posProfile
				? evaluateCachedPosSession(cached?.session, posProfile, cached?.ttlHours)
				: { status: "missing" as const },
		[cached?.session, cached?.ttlHours, posProfile],
	);

	useEffect(() => {
		if (cachedPolicy.status !== "valid") {
			return;
		}
		const remaining = cachedPolicy.expiresAt.getTime() - Date.now();
		const timer = window.setTimeout(() => refreshExpiry((value) => value + 1), Math.max(remaining + 100, 100));
		return () => window.clearTimeout(timer);
	}, [cachedPolicy]);

	if (!posProfile || isLoading || cached === undefined) {
		return <SessionMessage title="Checking POS session" message="Confirming that this till is ready for sales..." />;
	}

	if (session && !session.ready) {
		return (
			<PosOpeningEntryDialog
				posProfile={posProfile}
				modesOfPayment={getPaymentModes(bootstrap.data)}
				onSuccess={() => window.location.reload()}
			/>
		);
	}

	if (error) {
		if (cachedPolicy.status === "valid") {
			return (
			<>
				<div className="fixed inset-x-0 top-0 z-50 bg-secondary-container px-4 py-2 text-center text-xs font-medium text-on-secondary-container shadow-sm">
					Offline session: using opening entry {cachedPolicy.session.opening_entry}, verified {formatDate(cachedPolicy.session.verified_at)}.
				</div>
				{children}
			</>
			);
		}

		const expired = cachedPolicy.status === "expired";
		return (
			<SessionMessage
				title={expired ? "Offline POS session expired" : "Offline POS session unavailable"}
				message={
					expired
						? "Reconnect to verify that your opening entry is still active before completing another sale."
						: "This device has no verified open session for this POS Profile. Reconnect and open the POS before selling."
				}
				retry
			/>
		);
	}

	return <>{children}</>;
}

function formatDate(value: string | null | undefined): string {
	if (!value) return "unknown time";
	const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
	return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function SessionMessage({ title, message, retry = false }: { title: string; message: string; retry?: boolean }) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
			<div className="max-w-md text-center">
				<h1 className="text-lg font-semibold">{title}</h1>
				<p className="mt-2 text-sm text-on-surface-variant">{message}</p>
				{retry ? (
					<Button className="mt-4" onClick={() => window.location.reload()}>
						Retry connection
					</Button>
				) : null}
			</div>
		</div>
	);
}
