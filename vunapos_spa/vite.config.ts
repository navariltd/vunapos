import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from 'vite-plugin-pwa';

import proxyOptions from "./proxyOptions";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), VitePWA({
		registerType: 'autoUpdate',
		manifest: {
			name: 'VunaPOS',
			short_name: 'Vuna',
			description: 'Point of sale for Vuna',
			start_url: '/vunapos',
			scope: '/',
			display: 'standalone',
			theme_color: '#1976d2',
			icons: [
				{
					src: 'logo.png',
					sizes: '192x192',
					type: 'image/png'
				},
				{
					src: 'logo.png',
					sizes: '512x512',
					type: 'image/png'
				},
			]
		}
	})],
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
