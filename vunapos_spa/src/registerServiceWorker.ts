export function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/api/method/vunapos.pwa.service_worker", {
			scope: "/vunapos/",
			type: "classic",
		});
	});
}
