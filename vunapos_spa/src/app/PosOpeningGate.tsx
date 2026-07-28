import { Button } from "../components/ui/Button";
import { PosOpeningEntryDialog } from "../features/pos/components/PosOpeningEntryDialog";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { usePosSessionStatus } from "../features/pos/hooks/usePosSessionStatus";
import { getPaymentModes } from "../features/pos/utils";

type PosOpeningGateProps = {
	children: React.ReactNode;
};

export function PosOpeningGate({ children }: PosOpeningGateProps) {
	const bootstrap = useBootstrapData();
	const posProfile = bootstrap.data?.pos_profile;
	const { session, isLoading, error } = usePosSessionStatus(posProfile);
	if (!posProfile || isLoading) {
		return <SessionMessage title="Checking POS session" message="Confirming that this till is ready for sales..." />;
	}

	if (session && !session.ready) {
		if (session.status === "CLOSING" || session.status === "CLOSING_FAILED") {
			return (
				<SessionMessage
					title={session.status === "CLOSING" ? "POS closing in progress" : "POS closing needs attention"}
					message={
						session.status === "CLOSING"
							? "ERPNext is consolidating this shift. Sales remain blocked until closing completes."
							: `Closing entry ${session.closing_entry || ""} failed. Ask a supervisor to resolve or retry it before selling.`
					}
					retry
				/>
			);
		}
		return (
			<PosOpeningEntryDialog
				posProfile={posProfile}
				modesOfPayment={getPaymentModes(bootstrap.data)}
				onSuccess={() => window.location.reload()}
			/>
		);
	}

	if (error) {
		return (
			<SessionMessage
				title="Connection required"
				message="VunaPOS must reach the server to verify the current opening entry before allowing sales. Reconnect and try again."
				retry
			/>
		);
	}

	return <>{children}</>;
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
