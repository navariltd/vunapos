import { Button } from "../components/ui/Button";
import { useOfflineSync } from "../features/pos/hooks/useOfflineSync";

type BootstrapGateProps = {
	children: React.ReactNode;
};

// The only real hard block in the app: no offline data cached yet, and no way to
// fetch it. Every other bad state (stale cache, a failed background refresh) still
// lets the cashier sell - this screen is for that one case only.
function isMissingPosProfileError(message: string | null): boolean {
	return Boolean(message && message.toLowerCase().includes("no pos profile"));
}

export function BootstrapGate({ children }: BootstrapGateProps) {
	const { phase, error, retry } = useOfflineSync();

	if (phase === "blocked") {
		// Not a connectivity problem - a config problem the "try again" retry can't
		// fix. Give this its own message instead of the generic "connect once" one.
		if (isMissingPosProfileError(error)) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
					<div className="max-w-sm text-center">
						<h1 className="text-lg font-semibold text-on-surface">POS setup required</h1>
						<p className="mt-2 text-sm text-on-surface-variant">
							No POS Profile has been assigned to your account. Please contact your administrator to
							complete your POS setup.
						</p>
					</div>
				</div>
			);
		}

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
