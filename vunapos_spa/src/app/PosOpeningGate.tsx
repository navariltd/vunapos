import { PosOpeningEntryDialog } from "../features/pos/components/PosOpeningEntryDialog";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { usePosSessionStatus } from "../features/pos/hooks/usePosSessionStatus";
import { getPaymentModes } from "../features/pos/utils";

type PosOpeningGateProps = {
	children: React.ReactNode;
};

// Sits after BootstrapGate (a POS Profile is already confirmed resolved by then) and
// before the rest of the app: blocks selling until today's POS Opening Entry exists,
// same "hard block, no bypass" shape as BootstrapGate's own hard block. Fails open
// (renders children) while the session-status check is still loading or fails
// outright - a technical hiccup checking this must never itself stop a cashier who
// already has a real open session, matching this app's established rule that a
// failed background check never blocks selling (see BootstrapGate.tsx).
export function PosOpeningGate({ children }: PosOpeningGateProps) {
	const bootstrap = useBootstrapData();
	const posProfile = bootstrap.data?.pos_profile;
	const { session, isLoading, error } = usePosSessionStatus(posProfile);

	if (!posProfile || isLoading || error) {
		return <>{children}</>;
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

	return <>{children}</>;
}
