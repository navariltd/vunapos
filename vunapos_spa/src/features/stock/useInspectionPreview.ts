import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { stockMethods } from "./types";
import type { Inspection } from "./QualityInspectionDialog";
import type { InspectionContext } from "./InspectionParameterCell";

export type InspectionPreview = { status: string; readings: string[] };

export function inspectionPreviewKey(inspection: Inspection | null) {
  if (!inspection) return "";
  return JSON.stringify({
    name: inspection.name,
    modified: inspection.modified,
    template: inspection.template,
    manual_inspection: inspection.manual_inspection,
    status:
      inspection.manual_inspection || !inspection.readings.length
        ? inspection.status
        : undefined,
    readings: inspection.readings.map(({ status, ...reading }) => ({
      ...reading,
      status: reading.manual_inspection ? status : undefined,
    })),
  });
}

export function mergeInspectionPreview(
  current: Inspection | null,
  key: string,
  preview: InspectionPreview
): Inspection | null {
  if (
    !current ||
    inspectionPreviewKey(current) !== key ||
    current.readings.length !== preview.readings.length
  )
    return current;
  return {
    ...current,
    status: preview.status,
    readings: current.readings.map((row, i) => ({
      ...row,
      status: preview.readings[i],
    })),
  };
}

export function useInspectionPreview(
  inspection: Inspection | null,
  context: InspectionContext,
  enabled: boolean,
  revision: number,
  onPreview: Dispatch<SetStateAction<Inspection | null>>
) {
  const { call } = useFrappePostCall(stockMethods.previewInspection);
  const [settledKey, setSettledKey] = useState("");
  const [error, setError] = useState({ key: "", message: "" });
  const key = inspectionPreviewKey(inspection);
  const complete = Boolean(
    inspection && inspection.readings.every((row) => row.specification.trim())
  );
  const { pos_profile, stock_entry, receipt, row_name } = context;
  useEffect(() => {
    if (!enabled || !key) return;
    const payload = JSON.parse(key) as Inspection;
    if (payload.readings.some((row) => !row.specification.trim())) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setError({ key, message: "" });
      void call({ pos_profile, stock_entry, receipt, row_name, payload })
        .then((response) => {
          const preview = unwrapVunaResponse<InspectionPreview>(response);
          if (!cancelled)
            onPreview((current) =>
              mergeInspectionPreview(current, key, preview)
            );
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError({
              key,
              message:
                cause instanceof Error
                  ? cause.message
                  : "Unable to check the readings. Your entries have been kept.",
            });
        })
        .finally(() => {
          if (!cancelled) setSettledKey(key);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    call,
    key,
    enabled,
    revision,
    onPreview,
    pos_profile,
    stock_entry,
    receipt,
    row_name,
  ]);
  return {
    calculating: enabled && complete && settledKey !== key,
    error: enabled && error.key === key ? error.message : "",
  };
}
