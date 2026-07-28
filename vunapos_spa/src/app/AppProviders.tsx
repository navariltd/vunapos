import { FrappeProvider } from "frappe-react-sdk";

import { FRAPPE_URL } from "../config/frappe";

type AppProvidersProps = {
	children: React.ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
	// enableSocket defaults to true and opens a websocket this app never uses (no
	// useFrappeEventListener anywhere); left on it retries indefinitely and floods
	// the console whenever connectivity is interrupted.
	return (
		<FrappeProvider url={FRAPPE_URL} enableSocket={false}>
			{children}
		</FrappeProvider>
	);
}
