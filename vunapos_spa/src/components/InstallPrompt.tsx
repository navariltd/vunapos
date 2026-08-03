import { useCallback, useEffect, useState } from "react";
import { Share, X } from "lucide-react";

import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "vunapos_install_dismissed_at";
const DISMISS_DAYS = 7;
const CLOSE_ANIMATION_MS = 250;

function isIos() {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isRecentlyDismissed() {
  const dismissedAt = window.localStorage.getItem(DISMISS_KEY);
  if (!dismissedAt) {
    return false;
  }
  const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
  return daysSince < DISMISS_DAYS;
}

function rememberDismissal() {
  window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

// Chrome/Android no longer auto-shows an install banner, so we capture
// `beforeinstallprompt` and display our own sheet.
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showIosMessage, setShowIosMessage] = useState(
    () => isIos() && !isStandalone() && !isRecentlyDismissed(),
  );

  useEffect(() => {
    if (isStandalone() || isRecentlyDismissed()) {
      return undefined;
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsOpen(true);
    }

    function handleAppInstalled() {
      setIsOpen(false);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // Lock background scroll while the sheet is open
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const closeSheet = useCallback(() => {
    setIsClosing(true);
    window.setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, []);

  const handleDismiss = useCallback(() => {
    rememberDismissal();
    closeSheet();
  }, [closeSheet]);

  // Close on Escape for keyboard users
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleDismiss();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleDismiss]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome !== "accepted") {
      rememberDismissal();
    }
    setDeferredPrompt(null);
    closeSheet();
  }, [closeSheet, deferredPrompt]);

  if (isOpen) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:p-4",
          isClosing ? "animate-fade-out" : "animate-fade-in",
        )}
        onClick={handleDismiss}
      >
        <div
          className={cn(
            "w-full max-w-sm rounded-t-xl border border-outline-variant border-b-0 bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-lg sm:mb-6 sm:rounded-xl sm:border-b sm:pb-5",
            isClosing ? "animate-sheet-out" : "animate-sheet-in",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Install VunaPOS"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-outline-variant sm:hidden" />

          <div className="flex items-center gap-3.5 text-left">
            <img
              src="/vuna-192x192.png"
              alt=""
              className="size-11 shrink-0 rounded-md shadow-sm"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                Install VunaPOS
              </p>
              <p className="mt-0.5 text-xs leading-snug text-on-surface-variant">
                Add it to your home screen for a faster, full-screen experience.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={handleDismiss}>
              Not now
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleInstall}
            >
              Install
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showIosMessage) {
    return (
      <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-outline-variant bg-surface p-4 shadow-lg lg:bottom-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-on-surface">
            Install VunaPOS
          </p>
          <button
            type="button"
            onClick={() => {
              rememberDismissal();
              setShowIosMessage(false);
            }}
            aria-label="Dismiss"
          >
            <X className="size-4 text-on-surface-variant" />
          </button>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-on-surface-variant">
          Tap <Share className="size-3.5" aria-hidden="true" /> then "Add to
          Home Screen".
        </p>
      </div>
    );
  }

  return null;
}
