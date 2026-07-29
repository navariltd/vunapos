import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { Button } from "../components/ui/Button";
import { PosOpeningEntryDialog } from "../features/pos/components/PosOpeningEntryDialog";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { usePosSessionStatus } from "../features/pos/hooks/usePosSessionStatus";
import type { POSProfileOptionDTO } from "../features/pos/types";
import { getPaymentModes } from "../features/pos/utils";
import { hydrate } from "../lib/cacheEngine";
import { replacePosPage } from "../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../services/vunaApi";

type PosOpeningGateProps = {
	children: React.ReactNode;
};

export function PosOpeningGate({ children }: PosOpeningGateProps) {
	const bootstrap = useBootstrapData();
	const posProfile = bootstrap.data?.pos_profile;
	const { session, isLoading, error, reload } = usePosSessionStatus(posProfile);
	const profilesCall = useFrappeGetCall<unknown>(
		vunaMethods.getPosProfilesForUser,
		{},
		"vunapos_assigned_pos_profiles",
	);
	const profiles = useMemo(() => {
		if (!profilesCall.data) return [];
		try {
			return unwrapVunaResponse<POSProfileOptionDTO[]>(profilesCall.data);
		} catch {
			return [];
		}
	}, [profilesCall.data]);
	const [switchingProfile, setSwitchingProfile] = useState(false);

	async function selectProfile(profile: string) {
		if (!profile || profile === posProfile) return;
		setSwitchingProfile(true);
		try {
			await hydrate(profile);
		} finally {
			setSwitchingProfile(false);
		}
	}

	function handleOpeningSuccess() {
		// Preserve the selected profile and only refresh its live session state.
		// Reloading the page would let the server resolve another assigned profile.
		replacePosPage("Home");
		void reload();
	}

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
				profiles={profiles}
				onPosProfileChange={selectProfile}
				profileSwitching={switchingProfile}
				modesOfPayment={getPaymentModes(bootstrap.data)}
				onSuccess={handleOpeningSuccess}
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
