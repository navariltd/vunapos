import { useCallback, useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
	return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

function isStandalone() {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(window.navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

// Chrome on Android no longer shows an install banner on its own — the app has to
// capture `beforeinstallprompt`, suppress it, and drive its own UI that later calls
// `.prompt()`. iOS Safari never fires that event at all, so it gets a manual hint instead.
export function InstallPrompt() {
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [showDialog, setShowDialog] = useState(false);
	const [showIosMessage, setShowIosMessage] = useState(() => isIos() && !isStandalone());

	useEffect(() => {
		function handleBeforeInstallPrompt(event: Event) {
			event.preventDefault();
			setDeferredPrompt(event as BeforeInstallPromptEvent);
			setShowDialog(true);
		}

		function handleAppInstalled() {
			setShowDialog(false);
			setDeferredPrompt(null);
		}

		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		window.addEventListener("appinstalled", handleAppInstalled);
		return () => {
			window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, []);

	const install = useCallback(async () => {
		if (!deferredPrompt) return;
		await deferredPrompt.prompt();
		setShowDialog(false);
		setDeferredPrompt(null);
	}, [deferredPrompt]);

	if (showDialog) {
		return (
			<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
				<Card className="w-full max-w-sm bg-surface p-5 shadow-lg">
					<h2 className="text-base font-semibold text-on-surface">Install VunaPOS</h2>
					<p className="mt-1 text-sm text-on-surface-variant">
						Add VunaPOS to your home screen for quick, full-screen access.
					</p>
					<div className="mt-4 flex justify-end gap-2">
						<Button variant="ghost" onClick={() => setShowDialog(false)}>
							Not now
						</Button>
						<Button variant="primary" onClick={install}>
							<Download className="mr-2 size-4" aria-hidden="true" />
							Install
						</Button>
					</div>
				</Card>
			</div>
		);
	}

	if (showIosMessage) {
		return (
			<div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-surface-container-high p-4 shadow-lg lg:bottom-4">
				<div className="flex items-start justify-between gap-2">
					<p className="text-sm font-semibold text-on-surface">Install VunaPOS</p>
					<button type="button" onClick={() => setShowIosMessage(false)} aria-label="Dismiss">
						<X className="size-4 text-on-surface-variant" />
					</button>
				</div>
				<p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-on-surface-variant">
					Tap <Share className="size-3.5" aria-hidden="true" /> then "Add to Home Screen".
				</p>
			</div>
		);
	}

	return null;
}
