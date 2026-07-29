import { FrappeProvider } from "frappe-react-sdk";

import { FRAPPE_SITE_NAME, FRAPPE_SOCKET_PORT, FRAPPE_URL } from "../config/frappe";

type AppProvidersProps = {
	children: React.ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
	return (
		<FrappeProvider
			url={FRAPPE_URL}
			enableSocket
			siteName={FRAPPE_SITE_NAME}
			socketPort={FRAPPE_SOCKET_PORT}
		>
			{children}
		</FrappeProvider>
	);
}
