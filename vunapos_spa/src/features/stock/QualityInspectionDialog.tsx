import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { stockMethods } from "./types";
import { useInspectionPreview } from "./useInspectionPreview";
import { InspectionReadingsTable } from "./InspectionReadingsTable";
import {
  InspectionParameterCell,
  type InspectionContext,
} from "./InspectionParameterCell";

export type Inspection = {
  name: string | null;
  modified: string | null;
  docstatus: number;
  item_name: string;
  template?: string;
  sample_size: number;
  remarks: string;
  status: string;
  manual_inspection: boolean;
  overall_manual?: boolean;
  can_create_parameter?: boolean;
  can_write: boolean;
  can_submit: boolean;
  workflow?: {
    state: string;
    actions: Array<{ action: string; next_state: string }>;
  } | null;
  readings: Array<{
    client_id?: string;
    name?: string | null;
    additional?: boolean;
    create_parameter?: boolean;
    specification: string;
    numeric: number;
    manual_inspection: number;
    min_value: number;
    max_value: number;
    value?: string;
    formula_based_criteria: number;
    acceptance_formula?: string;
    values: string[];
    reading_value?: string;
    status: string;
  }>;
};

const inputStyle =
  "w-full rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm disabled:opacity-70";

export function InspectionActions({
  inspection,
  dirty,
  disabled,
  previewBlocked,
  onSave,
  onSubmit,
  onWorkflow,
}: {
  inspection: Inspection | null;
  dirty: boolean;
  disabled: boolean;
  previewBlocked: boolean;
  onSave: () => void;
  onSubmit: () => void;
  onWorkflow: (action: string) => void;
}) {
  if (!inspection || inspection.docstatus !== 0) return null;
  if (!inspection.name || dirty)
    return inspection.can_write ? (
      <Button disabled={disabled} onClick={onSave}>
        {inspection.name ? "Save" : "Save Draft"}
      </Button>
    ) : null;
  return (
    <>
      {inspection.can_write && inspection.can_submit ? (
        <Button disabled={disabled || previewBlocked} onClick={onSubmit}>
          Submit Inspection
        </Button>
      ) : null}
      {inspection.workflow?.actions.map((action) => (
        <Button
          key={action.action}
          disabled={disabled}
          title={`Move to ${action.next_state}`}
          onClick={() => onWorkflow(action.action)}
        >
          {action.action}
        </Button>
      ))}
    </>
  );
}

function ResultSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label="Status"
      className={inputStyle}
      value={value || "Rejected"}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="Accepted">Accepted</option>
      <option value="Rejected">Rejected</option>
    </select>
  );
}

export function InspectionFields({
  inspection,
  disabled,
  onChange,
  context,
  onTemplate,
}: {
  inspection: Inspection;
  disabled: boolean;
  onChange: (value: Inspection) => void;
  context?: InspectionContext;
  onTemplate?: (template: string) => void;
}) {
  const updateReading = (
    index: number,
    change: Partial<Inspection["readings"][number]>
  ) =>
    onChange({
      ...inspection,
      status: inspection.manual_inspection ? inspection.status : "Rejected",
      readings: inspection.readings.map((row, i) =>
        i === index ? { ...row, ...change } : row
      ),
    });
  return (
    <div className="space-y-5">
      {context ? (
        <div className="max-w-lg space-y-1 text-sm font-medium">
          <span>Quality Inspection Template</span>
          <InspectionParameterCell
            key={inspection.template || "no-template"}
            context={context}
            value={inspection.template || ""}
            method={stockMethods.inspectionTemplates}
            label="Quality Inspection Template"
            selectOnly
            canCreate={false}
            excluded={[]}
            disabled={disabled}
            autoFocus={false}
            onChange={(template) => onTemplate?.(template)}
          />
        </div>
      ) : inspection.template ? (
        <p className="text-sm">
          Quality Inspection Template: {inspection.template}
        </p>
      ) : null}
      <label className="block max-w-xs text-sm font-medium">
        Sample size
        <input
          className={`${inputStyle} mt-1`}
          type="number"
          min="0"
          step="any"
          required
          value={inspection.sample_size}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...inspection, sample_size: Number(event.target.value) })
          }
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={inspection.manual_inspection}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...inspection,
              manual_inspection: event.target.checked,
              overall_manual: event.target.checked,
              status: "Rejected",
            })
          }
        />
        Manual Inspection
      </label>
      <InspectionReadingsTable
        readings={inspection.readings}
        context={context}
        canCreate={Boolean(inspection.can_create_parameter)}
        disabled={disabled}
        onChange={updateReading}
        onRemove={(index) =>
          onChange({
            ...inspection,
            readings: inspection.readings.filter((_, i) => i !== index),
          })
        }
      />
      {context && inspection.can_write ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...inspection,
              readings: [
                ...inspection.readings,
                {
                  client_id: crypto.randomUUID(),
                  additional: true,
                  specification: "",
                  numeric: 1,
                  manual_inspection: 0,
                  min_value: 0,
                  max_value: 0,
                  formula_based_criteria: 0,
                  values: Array(10).fill(""),
                  status: "Rejected",
                },
              ],
              status: inspection.manual_inspection
                ? inspection.status
                : "Rejected",
            })
          }
        >
          Add row
        </Button>
      ) : null}
      <label className="block max-w-xs text-sm font-medium">
        Status
        <ResultSelect
          value={inspection.status}
          disabled={disabled}
          onChange={(status) => onChange({ ...inspection, status })}
        />
      </label>
      {!inspection.manual_inspection && inspection.readings.length ? (
        <p className="text-xs text-on-surface-variant">
          The overall status updates from the readings as you enter them. Enable
          Manual Inspection above to set it manually.
        </p>
      ) : null}
      {!inspection.readings.length ? (
        <p className="text-xs text-on-surface-variant">
          No inspection checks are configured. Select a status and record your
          findings in Remarks.
        </p>
      ) : null}
      <label className="block text-sm font-medium">
        Remarks
        <textarea
          className={`${inputStyle} mt-1`}
          rows={3}
          value={inspection.remarks}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...inspection, remarks: event.target.value })
          }
        />
      </label>
    </div>
  );
}

export function QualityInspectionDialog({
  profile,
  source,
  receipt,
  row,
  online,
  onClose,
  onSaved,
}: {
  profile: string;
  source: string;
  receipt: string;
  row: string;
  online: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { call: load } = useFrappePostCall(stockMethods.inspectionDetails);
  const { call: save } = useFrappePostCall(stockMethods.saveInspection);
  const { call: loadTemplate } = useFrappePostCall(
    stockMethods.inspectionTemplateDetails
  );
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const livePreview = useInspectionPreview(
    inspection,
    { pos_profile: profile, stock_entry: source, receipt, row_name: row },
    online && !busy && Boolean(inspection?.can_write),
    previewRevision,
    setInspection
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const confirmationOpen = discardOpen || templateChoice !== null;
  const [confirm, setConfirm] = useState<string | null>(null);
  const running = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const discardDialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirmationOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    discardDialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      previous?.focus();
    };
  }, [confirmationOpen]);
  useEffect(() => {
    let cancelled = false;
    void load({
      pos_profile: profile,
      stock_entry: source,
      receipt,
      row_name: row,
    })
      .then((response) => {
        if (!cancelled) setInspection(unwrapVunaResponse<Inspection>(response));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to open this inspection."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [load, profile, source, receipt, row]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };
  const applyTemplate = async (template: string) => {
    if (running.current || !online) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const preview = unwrapVunaResponse<Inspection>(
        await loadTemplate({
          pos_profile: profile,
          stock_entry: source,
          receipt,
          row_name: row,
          template,
        })
      );
      setInspection((current) =>
        current
          ? {
              ...current,
              template: preview.template,
              readings: preview.readings,
              status: "Rejected",
            }
          : current
      );
      setDirty(true);
      setConfirm(null);
      setTemplateChoice(null);
      setNotice("");
    } catch (cause) {
      setTemplateChoice(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load this template. Your current readings have been kept."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const persist = async (submit = false, action?: string) => {
    if (!inspection || !online || running.current) return;
    if ((submit || action) && (dirty || !inspection.name)) {
      setConfirm(null);
      setError(
        "Save the inspection changes before submitting or applying a workflow action."
      );
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = unwrapVunaResponse<Inspection>(
        await save({
          pos_profile: profile,
          stock_entry: source,
          receipt,
          row_name: row,
          payload: { ...inspection, submit, action },
        })
      );
      setInspection(saved);
      setDirty(false);
      setConfirm(null);
      setNotice(
        saved.docstatus === 1
          ? "Inspection submitted. You can return to the receipt."
          : "Inspection saved. Review the result before continuing."
      );
      try {
        await onSaved();
      } catch {
        setError(
          "Inspection saved, but the receipt could not refresh. Refresh the receipt before submitting it."
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save. Your readings are still here; reopen the inspection if its state is uncertain."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-2 sm:p-4">
      <div
        ref={dialog}
        inert={confirmationOpen}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-title"
        className="flex h-[calc(100dvh-2rem)] max-h-[52rem] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) close();
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"
            );
            if (!controls?.length) {
              event.preventDefault();
              return;
            }
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-outline-variant p-4">
          <div>
            <h2 id="inspection-title" className="text-lg font-semibold">
              Quality inspection
            </h2>
            <p className="mt-1 text-sm">
              {inspection?.item_name || "Receipt item"} · {receipt}
            </p>
            {inspection?.name ? (
              <p className="mt-1 text-xs text-on-surface-variant">
                {inspection.name} ·{" "}
                {inspection.docstatus === 1
                  ? "Submitted"
                  : inspection.workflow?.state || "Draft"}{" "}
                · {inspection.status}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            disabled={busy}
            aria-label="Close inspection"
            onClick={close}
          >
            <X className="size-5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {livePreview.calculating ? (
            <p role="status" className="text-xs text-on-surface-variant">
              Checking readings…
            </p>
          ) : null}
          {livePreview.error ? (
            <p role="alert" className="text-sm text-error">
              {livePreview.error}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-error-container p-3 text-sm text-on-error-container"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="rounded-md bg-surface-container p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}
          {!online ? (
            <p role="status" className="text-sm">
              Connect to the server to save or submit an inspection.
            </p>
          ) : null}
          {inspection ? (
            <InspectionFields
              inspection={inspection}
              context={{
                pos_profile: profile,
                stock_entry: source,
                receipt,
                row_name: row,
              }}
              onTemplate={(template) => {
                if (template === inspection.template) return;
                if (inspection.readings.length) setTemplateChoice(template);
                else void applyTemplate(template);
              }}
              disabled={busy || !online || !inspection.can_write}
              onChange={(value) => {
                setInspection(value);
                setDirty(true);
                setPreviewRevision((current) => current + 1);
                setConfirm(null);
              }}
            />
          ) : !error ? (
            <p role="status">Loading inspection…</p>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant p-4">
          {confirm !== null ? (
            <div
              className="w-full rounded-md bg-surface-container p-3 text-sm"
              role="status"
            >
              <p>
                {confirm
                  ? `Apply “${confirm}” to this inspection?`
                  : "Submit this inspection with the readings and result shown above?"}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy || !online}
                  onClick={() => void persist(!confirm, confirm || undefined)}
                >
                  {busy ? "Saving…" : "Confirm"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={close}>
                Close
              </Button>
              <InspectionActions
                inspection={inspection}
                dirty={dirty}
                disabled={busy || !online}
                previewBlocked={
                  livePreview.calculating || Boolean(livePreview.error)
                }
                onSave={() => void persist()}
                onSubmit={() => setConfirm("")}
                onWorkflow={setConfirm}
              />
            </>
          )}
        </footer>
      </div>
      <div
        ref={discardDialog}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || !confirmationOpen) return;
          const controls = discardDialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled)"
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <ConfirmDialog
          isOpen={discardOpen}
          title="Discard inspection changes?"
          description="Your unsaved readings and changes will be lost. Any previously saved inspection will remain unchanged."
          cancelLabel="Keep editing"
          confirmLabel="Discard changes"
          danger
          onCancel={() => setDiscardOpen(false)}
          onConfirm={onClose}
        />
        <ConfirmDialog
          isOpen={templateChoice !== null}
          title="Replace inspection checks?"
          description="Selecting this template replaces the current checks and their readings. The inspection is not changed on the server until you save."
          cancelLabel="Keep current checks"
          confirmLabel="Load template"
          loading={busy}
          onCancel={() => setTemplateChoice(null)}
          onConfirm={() => {
            if (templateChoice) void applyTemplate(templateChoice);
          }}
        />
      </div>
    </div>
  );
}
