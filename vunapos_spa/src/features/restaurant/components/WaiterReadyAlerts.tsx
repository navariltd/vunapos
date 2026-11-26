import { useCallback, useContext, useEffect } from "react";
import { FrappeContext } from "frappe-react-sdk";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import { useKitchenSound } from "../hooks/useKitchenSound";
import {
  subscribeWaiterReady,
  type KitchenReadyEvent,
} from "../kitchenRealtime";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { SoundPreferences } from "../soundPreferences";

export function WaiterReadyAlerts({
  user,
  soundSettings,
}: {
  user: string;
  soundSettings?: SoundPreferences;
}) {
  const socket = useContext(FrappeContext)?.socket;
  const sound = useKitchenSound("ready", soundSettings);
  const chime = sound.onCreated;
  const onReady = useCallback(
    (event: KitchenReadyEvent) => {
      const destination = event.table_labels
        ? `Table ${event.table_labels}`
        : event.sales_order;
      useUiFeedbackStore.getState().showToast({
        type: "info",
        message: `Food ready to collect · ${destination} · ${event.station_label} · ${event.ticket}`,
      });
      useOrderDraftStore.getState().markOrdersChanged();
      chime(event.event_id);
    },
    [chime]
  );
  useEffect(() => {
    if (!socket) return;
    return subscribeWaiterReady(socket, user, onReady);
  }, [socket, user, onReady]);

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={sound.busy || !sound.configured}
        aria-pressed={sound.enabled}
        aria-label={sound.enabled ? "Mute ready alerts" : "Enable ready alerts"}
        title={
          sound.enabled
            ? "Mute sounds when your orders are ready"
            : "Enable sounds when your orders are ready"
        }
        onClick={() => (sound.enabled ? sound.mute() : void sound.enable())}
      >
        {sound.enabled ? (
          <Volume2 className="mr-1 size-4" aria-hidden="true" />
        ) : (
          <VolumeX className="mr-1 size-4" aria-hidden="true" />
        )}
        {sound.configured
          ? `Ready alerts ${sound.enabled ? "on" : "off"}`
          : "Ready sound disabled in settings"}
      </Button>
      {sound.error ? (
        <span
          role="alert"
          className="absolute right-2 top-14 z-50 max-w-sm rounded-md bg-error-container p-3 text-sm text-on-error-container"
        >
          {sound.error}
        </span>
      ) : null}
    </div>
  );
}
