import { AppShell } from "../components/layout/AppShell";
import { InstallPrompt } from "../components/InstallPrompt";
import { POSHomePage } from "../features/pos/POSHomePage";
import { useBootstrapData } from "../features/pos/hooks/useBootstrapData";
import { AppProviders } from "./AppProviders";
import { AuthGate } from "./AuthGate";
import { BootstrapGate } from "./BootstrapGate";
import { ConnectivityMonitor } from "./ConnectivityMonitor";
import { PosOpeningGate } from "./PosOpeningGate";

export function App() {
	return (
		<AppProviders>
			<AuthGate>
				<BootstrapGate>
					<PosOpeningGate>
						<AuthenticatedApp />
					</PosOpeningGate>
				</BootstrapGate>
			</AuthGate>
		</AppProviders>
	);
}

function AuthenticatedApp() {
	const bootstrap = useBootstrapData();

	return (
		<>
			<ConnectivityMonitor />
			<AppShell
				cashier={bootstrap.data?.current_user}
				posProfile={bootstrap.data?.pos_profile}
				warehouse={bootstrap.data?.warehouse}
			>
				<POSHomePage bootstrap={bootstrap} />
			</AppShell>
			<InstallPrompt />
		</>
	);
}
