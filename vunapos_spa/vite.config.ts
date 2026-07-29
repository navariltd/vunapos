import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import commonSiteConfig from "../../../sites/common_site_config.json" with { type: "json" };

import proxyOptions from "./proxyOptions";

const defaultSite = (commonSiteConfig as { default_site?: string }).default_site || "";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
	plugins: [react(), tailwindcss()],
	define: {
		__FRAPPE_DEV_SITE__: JSON.stringify(command === "serve" ? defaultSite : ""),
	},
	server: {
		port: 8080,
		host: "0.0.0.0",
		proxy: proxyOptions,
	},
	build: {
		outDir: "../vunapos/public/vunapos",
		emptyOutDir: true,
		target: "es2015",
	},
}));
