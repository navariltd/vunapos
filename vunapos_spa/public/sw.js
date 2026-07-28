// Cache-free service worker retained only so VunaPOS remains installable as a PWA.
// All navigations, assets, and API requests continue directly to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter(
							(name) =>
								name.includes("workbox-precache") ||
								name.includes("workbox-runtime")
						)
						.map((name) => caches.delete(name))
				)
			)
			.then(() => self.clients.claim())
	);
});
