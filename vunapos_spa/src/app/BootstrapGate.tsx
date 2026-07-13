import { Button } from "../components/ui/Button";
import { useOfflineSync } from "../features/pos/hooks/useOfflineSync";

type BootstrapGateProps = {
	children: React.ReactNode;
};

// §10.1: the only legitimate hard block in the whole system - no cached master data
// and no way to fetch it. Every other state (stale cache, failed background refresh)
// still lets the cashier sell (ADR-007) - this screen exists for exactly one scenario.
export function BootstrapGate({ children }: BootstrapGateProps) {
	const { phase, error, retry } = useOfflineSync();

	if (phase === "blocked") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="max-w-sm text-center">
					<h1 className="text-lg font-semibold text-on-surface">Initial sync required</h1>
					<p className="mt-2 text-sm text-on-surface-variant">
						This device has no offline data yet and can't reach the server to download it. Connect to
						the internet once to prepare this terminal for offline sales.
					</p>
					{error ? <p className="mt-2 text-xs text-on-surface-variant">{error}</p> : null}
					<Button className="mt-4" onClick={retry}>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	if (phase === "hydrating") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="text-sm font-medium text-on-surface-variant">Preparing VunaPOS for offline use...</div>
			</div>
		);
	}

	return <>{children}</>;
}
