import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import proxyOptions from "./proxyOptions";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
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
});
