import { useEffect, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { deliverKitchenJob, connectKitchenPrinter } from "../../../services/kitchenPrinting";

const base = "vunapos.api.kitchen_printing.";
type Job = { name: string; kitchen_ticket: string; status: string; last_error?: string };
export function KitchenPrinting({ station }: { station: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const busy = useRef(false);
  const claim = useFrappePostCall(base + "claim");
  const dispatch = useFrappePostCall(base + "dispatch");
  const ack = useFrappePostCall(base + "acknowledge");
  const retry = useFrappePostCall(base + "retry");
  const confirm = useFrappePostCall(base + "confirm_delivery");
  const result = useFrappeGetCall<{message: Job[]}>(base + "status", {station}, [base, station], {refreshInterval: 5000});
  const operations = useRef({claim, dispatch, ack});
  useEffect(() => { operations.current = {claim, dispatch, ack}; }, [claim, dispatch, ack]);
  useEffect(() => {
    active.current = running;
    if (!running) return;
    async function tick() {
      if (!active.current || busy.current) return;
      busy.current = true;
      try {
        const api = operations.current;
        await deliverKitchenJob({
          claim: async () => (await api.claim.call({station})).message,
          dispatch: async job => (await api.dispatch.call(job)).message,
          acknowledge: (job, submitted, error) => api.ack.call({...job, submitted: submitted ? 1 : 0, error}),
        }, () => active.current);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Printing stopped. Review delivery status.";
        active.current = false; setRunning(false); setError(message);
      } finally { busy.current = false; }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => { active.current = false; window.clearInterval(timer); };
  }, [running, station]);
  return <section className="mb-4 rounded border border-outline-variant p-3">
    <h3 className="font-semibold">Kitchen printing</h3>
    <p className="text-sm">Keep this terminal open while printing. Submitted means accepted by the print service, not confirmed on paper.</p>
    <a className="text-primary" href={`/desk/kitchen-station/${encodeURIComponent(station)}`} target="_blank" rel="noreferrer">Station printer settings</a>
    <div className="my-2"><Button onClick={() => {
      if (running) { active.current = false; setRunning(false); return; }
      setError("");
      void connectKitchenPrinter().then(() => setRunning(true)).catch((e: Error) => setError(e.message));
    }}>{running ? "Stop printing" : "Start printing"}</Button></div>
    {(error || result.error) && <p role="alert">{error || "Unable to read printing status."}</p>}
    <ul className="text-sm">{result.data?.message?.map(job => <li key={job.name} className="my-2">
      {job.kitchen_ticket}: {job.status} {job.last_error}
      {job.status === "Uncertain" && <Button variant="ghost" onClick={() => {
        const reason = window.prompt("A manager must check that this ticket already printed. Record how you confirmed the existing copy; this will not print again.");
        if (reason) void confirm.call({name: job.name, reason}).then(() => result.mutate()).catch((e: Error) => setError(e.message));
      }}>Confirm existing print</Button>}
      {["Failed", "Uncertain"].includes(job.status) && <Button variant="ghost" onClick={() => {
        const reason = window.prompt("Check the printer first. Why is a retry needed? A manager must approve.");
        if (reason) void retry.call({name: job.name, reason}).then(() => result.mutate()).catch((e: Error) => setError(e.message));
      }}>Retry after review</Button>}
    </li>)}</ul>
  </section>;
}
