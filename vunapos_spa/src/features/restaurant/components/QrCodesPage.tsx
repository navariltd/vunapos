import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { navigateToPosPage } from "../../../lib/stores/navigationStore";
import { printHtml } from "../../../lib/printHtml";
import { getQrTables, printTableQrCards, regenerateTableQr, vunaMethods } from "../../../services/vunaApi";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useUiFeedbackStore } from "../../pos/stores/uiFeedbackStore";
import type { QrTablesDTO } from "../types";

type Table = QrTablesDTO["floors"][number]["tables"][number];

// Managers print each table's QR code, which guests scan to order from their phone.
// Printing creates a table's code the first time and never changes it afterwards;
// Regenerate replaces it, so the old printed code stops working.
export function QrCodesPage({ posProfile }: { posProfile?: string }) {
  const bootstrap = useBootstrapData();
  const canManage = Boolean(bootstrap.data?.can_manage_restaurant);
  const listCall = useFrappePostCall(vunaMethods.getQrTables);
  const printCall = useFrappePostCall(vunaMethods.printTableQrCards);
  const regenerateCall = useFrappePostCall(vunaMethods.regenerateTableQr);
  const showToast = useUiFeedbackStore((state) => state.showToast);
  const [data, setData] = useState<QrTablesDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Table | null>(null);
  const [printNew, setPrintNew] = useState<Table | null>(null);
  const running = useRef(false);
  const [revision, setRevision] = useState(0);
  const load = () => setRevision((value) => value + 1);

  useEffect(() => {
    if (!canManage || !posProfile) return undefined;
    let active = true;
    getQrTables(listCall.call, posProfile)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The tables could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [canManage, posProfile, listCall.call, revision]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    try {
      await action();
    } catch (reason) {
      showToast({ type: "error", message: reason instanceof Error ? reason.message : "That did not work. Try again." });
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const print = (key: string, tables: string[]) =>
    run(key, async () => {
      if (!posProfile) return;
      const cards = await printTableQrCards(printCall.call, { pos_profile: posProfile, tables });
      printHtml(cards.html);
      load();
    });

  const regenerate = (table: Table) =>
    run(`regenerate:${table.table}`, async () => {
      if (!posProfile) return;
      await regenerateTableQr(regenerateCall.call, { pos_profile: posProfile, table: table.table });
      setRegenerating(null);
      setPrintNew(table);
      load();
    });

  const back = (
    <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigateToPosPage("Floor")}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Floor
    </Button>
  );

  let body;
  if (!canManage) {
    body = <EmptyState title="Managers only" description="Ask a restaurant manager to print table QR codes." />;
  } else if (!data) {
    body = (
      <EmptyState
        title={error ? "Tables unavailable" : "Loading tables"}
        description={error || "Fetching the floors and tables of this branch."}
        action={error ? <Button onClick={load}>Try again</Button> : undefined}
      />
    );
  } else if (!data.floors.some((floor) => floor.tables.length)) {
    body = <EmptyState title="No tables yet" description="Add tables to the floor plan first." />;
  } else {
    body = (
      <div className="space-y-4">
        {!data.enabled ? (
          <p role="status" className="rounded-md border border-outline-variant bg-surface-container-low p-3 text-sm text-on-surface">
            QR ordering is switched off for this branch. Tick QR Table Ordering on one POS Profile of the branch
            (POS Profile, VunaPOS tab) to print codes.
          </p>
        ) : null}
        {data.floors
          .filter((floor) => floor.tables.length)
          .map((floor) => (
            <section key={floor.name} className="rounded-md border border-outline-variant bg-surface" aria-labelledby={`qr-floor-${floor.name}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-3 py-2 sm:px-4">
                <h3 id={`qr-floor-${floor.name}`} className="min-w-0 flex-1 truncate font-semibold text-on-surface">
                  {floor.floor_name}
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2"
                  disabled={!data.enabled || busy !== null}
                  onClick={() => void print(`floor:${floor.name}`, floor.tables.map((table) => table.table))}
                >
                  <Printer className="size-4" aria-hidden="true" />
                  {busy === `floor:${floor.name}` ? "Preparing…" : `Print all (${floor.tables.length})`}
                </Button>
              </div>
              <ul className="divide-y divide-outline-variant">
                {floor.tables.map((table) => (
                  <li key={table.table} className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-on-surface">Table {table.table_label}</span>
                      <span className="block text-xs text-on-surface-variant">
                        {table.has_code ? "Has a QR code" : "No QR code yet: printing creates one"}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2"
                      disabled={!data.enabled || busy !== null}
                      onClick={() => void print(`table:${table.table}`, [table.table])}
                    >
                      <Printer className="size-4" aria-hidden="true" />
                      {busy === `table:${table.table}` ? "Preparing…" : "Print"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2"
                      disabled={!data.enabled || busy !== null}
                      onClick={() => setRegenerating(table)}
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      Regenerate
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-4 pb-[84px] lg:pb-4">
      <div className="flex min-w-0 items-center gap-3">
        {back}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-on-surface">QR codes</h2>
      </div>
      <p className="text-sm text-on-surface-variant">
        Guests scan a table's code to send an order from their phone. Staff accept it before it reaches the kitchen.
        Each card prints on its own A6 page.
      </p>
      {body}
      <ConfirmDialog
        isOpen={regenerating !== null}
        danger
        title={`Regenerate the code for table ${regenerating?.table_label ?? ""}?`}
        description="The code printed for this table stops working at once. Print the new code and replace the card on the table."
        confirmLabel="Regenerate"
        loading={busy !== null && busy.startsWith("regenerate:")}
        onCancel={() => {
          if (busy === null) setRegenerating(null);
        }}
        onConfirm={() => {
          if (regenerating) void regenerate(regenerating);
        }}
      />
      <ConfirmDialog
        isOpen={printNew !== null}
        title={`Print the new code for table ${printNew?.table_label ?? ""}?`}
        description="The old card no longer works."
        confirmLabel="Print"
        cancelLabel="Later"
        loading={busy !== null}
        onCancel={() => setPrintNew(null)}
        onConfirm={() => {
          if (!printNew) return;
          const table = printNew.table;
          setPrintNew(null);
          void print(`table:${table}`, [table]);
        }}
      />
    </section>
  );
}
