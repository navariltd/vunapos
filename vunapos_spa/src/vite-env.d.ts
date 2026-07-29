/// <reference types="vite/client" />

declare const __FRAPPE_DEV_SITE__: string;

interface Window {
	frappe_site_name?: string;
}
