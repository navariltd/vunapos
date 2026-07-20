import { Button } from "../components/ui/Button";
import { useOfflineSync } from "../features/pos/hooks/useOfflineSync";

type BootstrapGateProps = {
	children: React.ReactNode;
};

// The only real hard block in the app: no offline data cached yet, and no way to
// fetch it. Every other bad state (stale cache, a failed background refresh) still
// lets the cashier sell - this screen is for that one case only.
function getPosProfileIssue(code: string | null, message: string | null): "missing" | "permission" | null {
	if (code === "POS_PROFILE_NOT_ASSIGNED" || code === "POS_PROFILE_NOT_ENABLED") return "missing";
	if (code === "POS_PROFILE_READ_DENIED") return "permission";

	// Compatibility with responses from a server that has not yet been migrated.
	const normalized = message?.toLowerCase() || "";
	if (normalized.includes("no pos profile") || normalized.includes("no enabled pos profile")) return "missing";
	if (normalized.includes("not permitted to read pos profile")) return "permission";
	return null;
}

export function BootstrapGate({ children }: BootstrapGateProps) {
	const { phase, error, errorCode, retry } = useOfflineSync();

	if (phase === "blocked") {
		// Not a connectivity problem - a config problem the "try again" retry can't
		// fix. Give this its own message instead of the generic "connect once" one.
		const profileIssue = getPosProfileIssue(errorCode, error);
		if (profileIssue) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
					<div className="max-w-sm text-center">
						<h1 className="text-lg font-semibold text-on-surface">
							{profileIssue === "missing" ? "No POS Profile assigned" : "POS Profile access required"}
						</h1>
						<p className="mt-2 text-sm text-on-surface-variant">
							{profileIssue === "missing"
								? "Your account does not have an enabled POS Profile assignment. Ask an administrator to add you to a POS Profile before using VunaPOS."
								: "Your account is assigned to a POS Profile, but does not have permission to read it. Ask an administrator to grant the required POS role or permissions."}
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
