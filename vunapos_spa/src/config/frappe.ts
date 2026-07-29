export const FRAPPE_URL = import.meta.env.VITE_FRAPPE_URL || window.location.origin;

// Bench exposes Socket.IO on port 9000 while Vite serves the SPA on port 8080.
// Production proxies Socket.IO through the site origin and must not force a port.
export const FRAPPE_SOCKET_PORT = import.meta.env.VITE_FRAPPE_SOCKET_PORT
	|| (import.meta.env.DEV ? "9000" : undefined);
const renderedSiteName = window.frappe_site_name?.startsWith("{{")
	? undefined
	: window.frappe_site_name;
export const FRAPPE_SITE_NAME = import.meta.env.VITE_FRAPPE_SITE_NAME
	|| renderedSiteName
	|| __FRAPPE_DEV_SITE__
	|| window.location.hostname;
