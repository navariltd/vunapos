import { FrappeProvider } from "frappe-react-sdk";

import { FRAPPE_URL } from "../config/frappe";

type AppProvidersProps = {
	children: React.ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
	return <FrappeProvider url={FRAPPE_URL}>{children}</FrappeProvider>;
}
