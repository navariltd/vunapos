import { retainKitchenStation } from "../kitchenRealtime";
import { createKitchenAudioEventHandlers } from "../kitchenAudioEvents";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { FrappeContext, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { createKitchenStationDrainer, deliverKitchenJob, listAvailablePrinters, printTestSlip } from "../../../services/kitchenPrinting";
import { usePrintLeaderLock } from "../hooks/usePrintLeaderLock";
import { enableKitchenAudio, playKitchenTone } from "../kitchenAudio";

const base = "vunapos.api.kitchen_printing.";
type Station = {name: string; station_name: string; printer_name: string; output_mode: string};
type Config = {stations: Station[]; user: string; can_print: boolean; can_manage: boolean; run_on_pos: boolean};
type Job = {name: string; kitchen_ticket: string; kitchen_station: string; status: string; ticket_kind: string; last_error?: string};
function stored(key: string) { try {return localStorage.getItem(key) || "";} catch {return "";} }
function preference(key: string) { return stored(key) === "1"; }

export function KitchenPrinting({posProfile, kitchenPage, user}: {posProfile: string; kitchenPage: boolean; user: string}) {
  const config = useFrappeGetCall<{message: Config}>(base + "configuration", {pos_profile: posProfile}, `printing-config:${user}:${posProfile}`, {refreshInterval: 15000});
  if (!config.data?.message.can_print || config.error) return config.error && kitchenPage ? <p role="alert">Kitchen printing configuration unavailable.</p> : null;
  if (!kitchenPage && !config.data.message.run_on_pos) return null;
  return <KitchenPrintWorker key={`${config.data.message.user}:${posProfile}`} config={config.data.message} posProfile={posProfile} />;
}

export function KitchenPrintWorker({config, posProfile}: {config: Config; posProfile: string}) {
  const scope = `${config.user}:${posProfile}`;
  const preferenceKey = `vunapos_autoprint_enabled:${scope}`;
  const [running, setRunning] = useState(() => preference(preferenceKey));
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState(() => stored(`vunapos_print_station:${scope}`));
  const [error, setError] = useState("");
  const [stationErrors, setStationErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{job: Job; confirm: boolean} | null>(null);
  const [reason, setReason] = useState("");
  const [sound, setSound] = useState(false);
  const [detail, setDetail] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const socket = useContext(FrappeContext)?.socket;
  const leader = usePrintLeaderLock(config.user, running);
  const audioLeader = usePrintLeaderLock(`audio:${config.user}`, sound);
  const stationKey = JSON.stringify(config.stations.filter(row => ["Printer", "Both"].includes(row.output_mode) && row.printer_name && printers.includes(row.printer_name) && (!selected || selected === row.name)).map(row => row.name).sort());
  const claims = useFrappePostCall(base + "claim_many");
  const releaseClaim = useFrappePostCall(base + "release_claim");
  const dispatch = useFrappePostCall(base + "dispatch");
  const ack = useFrappePostCall(base + "acknowledge");
  const retry = useFrappePostCall(base + "retry");
  const confirm = useFrappePostCall(base + "confirm_delivery");
  const printerConfigKey = JSON.stringify(config.stations);
  const statusNames = JSON.stringify(config.stations.map(row => row.name));
  const audioHandlers = useMemo(
    () => createKitchenAudioEventHandlers(
      JSON.parse(statusNames) as string[],
      playKitchenTone,
    ),
    [statusNames],
  );
  const result = useFrappeGetCall<{message: Job[]}>(base + "status_many", {stations: statusNames, pos_profile: posProfile}, config.stations.length ? `print-status:${scope}:${statusNames}` : null, {refreshInterval: 15000});
  const ops = useRef({claims, releaseClaim, dispatch, ack, refresh: result.mutate});
  useEffect(() => {ops.current = {claims, releaseClaim, dispatch, ack, refresh: result.mutate};}, [claims, releaseClaim, dispatch, ack, result.mutate]);
  function stop(message = "") {
    setRunning(false); setError(message); setStationErrors({});
    try {localStorage.removeItem(preferenceKey);} catch { /* Session state still stops the worker. */ }
  }
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    void listAvailablePrinters().then(found => {
      const stations: Station[] = JSON.parse(printerConfigKey);
      if (!stations.some(row => ["Printer", "Both"].includes(row.output_mode) && found.includes(row.printer_name) && (!selected || selected === row.name))) throw new Error("No configured station printer is available on this terminal.");
      if (!cancelled) setPrinters(found);
    }).catch((caught: Error) => {
      if (!cancelled) { setRunning(false); setError(caught.message); try {localStorage.removeItem(preferenceKey);} catch { /* No persisted opt-in available. */ } }
    });
    return () => {cancelled = true;};
  }, [running, preferenceKey, printerConfigKey, selected]);
  useEffect(() => {
    if (!review) return;
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, [review]);
  useEffect(() => {
    if (!leader || stationKey === "[]") return;
    let active = true;
    let busy = false;
    const stationNames: string[] = JSON.parse(stationKey);

    const drain = createKitchenStationDrainer(
      stationNames,
      station => {
        const api = ops.current;

        return deliverKitchenJob({
          claim: async () => (await api.claims.call({
            stations: [station], pos_profile: posProfile,
          })).message,
          release: job => api.releaseClaim.call({
            ...job, pos_profile: posProfile,
          }),
          dispatch: async job => (await api.dispatch.call({
            ...job, pos_profile: posProfile,
          })).message,
          acknowledge: (job, submitted, error) => api.ack.call({
            ...job, submitted: submitted ? 1 : 0, error,
            pos_profile: posProfile,
          }),
        }, () => active);
      },
      (station, message) => {
        setStationErrors(current => {
          const next = {...current};

          if (message) next[station] = message;
          else delete next[station];

          return next;
        });
      },
    );

    async function tick() {
      if (!active || busy) return;

      busy = true;

      try {
        await drain(() => active);
        if (active) await ops.current.refresh();
      } catch {
        // Status refresh failures must not stop station delivery.
      } finally {
        busy = false;
      }
    }
    const update = (value: unknown) => {
      const event = value as {kitchen_station?: string; status?: string; ticket_kind?: string} | null;
      if (!event?.kitchen_station || !stationNames.includes(event.kitchen_station)) return;
      if (event.status === "Queued") void tick();
      void ops.current.refresh();
    };
    const releases = socket ? stationNames.map(name => retainKitchenStation(socket, name)) : [];
    const subscribe = () => {void tick();};
    subscribe();
    socket?.on("connect", subscribe);
    socket?.on("vunapos_kitchen_print_job_queued", update);
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      active = false; window.clearInterval(timer);
      socket?.off("connect", subscribe); socket?.off("vunapos_kitchen_print_job_queued", update);
      releases.forEach(release => release());
    };
  }, [leader, stationKey, socket, posProfile]);
  useEffect(() => {
    if (!audioLeader || !socket) return;

    const stations: string[] = JSON.parse(statusNames);
    const releases = stations.map(name => retainKitchenStation(socket, name));

    socket.on("vunapos_kitchen_ticket_created", audioHandlers.arrival);
    socket.on("vunapos_kitchen_print_job_queued", audioHandlers.printJob);
    socket.on("vunapos_kitchen_action_saved", audioHandlers.action);

    return () => {
      socket.off("vunapos_kitchen_ticket_created", audioHandlers.arrival);
      socket.off("vunapos_kitchen_print_job_queued", audioHandlers.printJob);
      socket.off("vunapos_kitchen_action_saved", audioHandlers.action);
      releases.forEach(release => release());
    };
  }, [audioLeader, socket, statusNames, audioHandlers]);
  const stationWarnings = config.stations.filter(
    row => stationErrors[row.name] && (!selected || selected === row.name),
  );
  const unresolved = result.data?.message?.filter(job => ["Uncertain", "Failed"].includes(job.status)) || [];
  const missing = config.stations.filter(row => ["Printer", "Both"].includes(row.output_mode) && !printers.includes(row.printer_name));
  return <div className="border-b border-outline-variant bg-surface px-4 py-2 text-sm">
    <button type="button" className="rounded-full border px-3 py-1 font-medium" onClick={() => setDetail(!detail)}>
      Printer: {running
        ? leader
          ? stationWarnings.length || unresolved.length
            ? "Active — needs review"
            : "Active"
          : "Waiting for other tab"
        : error ? "Stopped" : "Off"}
    </button>
    {error && <span role="alert" className="ml-2 text-error">{error}</span>}
    {running && stationWarnings.map(row => (
      <p key={row.name} role="alert" className="mt-1 text-error">
        {row.station_name}: last delivery error — {stationErrors[row.name]}
      </p>
    ))}
    {detail && <div className="mt-2 space-y-2">
      <p>Submitted means accepted by the print service, not confirmed on paper. Select an 80mm roll in the printer driver.</p>
      <select aria-label="Printing stations" value={selected} disabled={running} onChange={e => {setSelected(e.target.value); try {localStorage.setItem(`vunapos_print_station:${scope}`, e.target.value);} catch {setError("Station selection could not be saved.");}}}>
        <option value="">All Stations on This Terminal</option>
        {config.stations.map(row => <option key={row.name} value={row.name}>{row.station_name}</option>)}
      </select>
      <Button size="sm" onClick={() => {
        if (running) {stop(); return;}
        if (!navigator.locks) {setError("This browser does not support safe single-tab printing. Use a browser with Web Locks."); return;}
        setError("");
        setStationErrors({});
        void listAvailablePrinters().then(found => {
          if (!config.stations.some(row => ["Printer", "Both"].includes(row.output_mode) && found.includes(row.printer_name) && (!selected || selected === row.name))) throw new Error("No configured station printer is available on this terminal.");
          setPrinters(found); localStorage.setItem(preferenceKey, "1"); setRunning(true);
          if (!preference(`vunapos_print_muted:${scope}`)) void enableKitchenAudio().then(() => setSound(true)).catch(() => { /* Audio opt-in remains available. */ });
        }).catch((caught: Error) => setError(caught.message));
      }}>{running ? "Stop printing" : "Start printing"}</Button>
      <Button size="sm" variant="ghost" onClick={() => void listAvailablePrinters().then(setPrinters).catch((caught: Error) => setError(caught.message))}>Discover printers</Button>
      <Button size="sm" variant="ghost" onClick={() => {
        if (sound) {setSound(false); try {localStorage.setItem(`vunapos_print_muted:${scope}`, "1");} catch { /* Session-only preference. */ } return;}
        void enableKitchenAudio().then(() => {setSound(true); localStorage.setItem(`vunapos_print_muted:${scope}`, "0");}).catch(() => setError("Browser could not enable audio."));
      }}>{sound ? "Mute alerts" : "Enable sound"}</Button>
      <p>Sound requires a click after opening the browser. Printing resumes on this terminal after refresh when enabled.</p>
      {printers.length > 0 && <p>Available printers: {printers.join(", ")}</p>}
      {missing.length > 0 && <p>Not available here: {missing.map(row => row.station_name).join(", ")}</p>}
      {config.stations.filter(row => printers.includes(row.printer_name)).map(row => <div key={row.name}>
        <a className="text-primary" href={`/desk/kitchen-station/${encodeURIComponent(row.name)}`} target="_blank" rel="noreferrer">{row.station_name}: {row.printer_name}</a>{" "}
        <Button size="sm" variant="ghost" disabled={running} onClick={() => void printTestSlip(row.printer_name, row.station_name).catch((caught: Error) => setError(caught.message))}>Print test slip</Button>
      </div>)}
      {result.error && <p role="alert">Unable to refresh printing status.</p>}
      {unresolved.length === 100 && <p>Showing the first 100 deliveries needing review.</p>}
      {unresolved.map(job => <div key={job.name}>{job.kitchen_ticket}: {job.status} {job.last_error}
        {config.can_manage && <>
          <Button size="sm" onClick={() => {setReview({job, confirm: false}); setReason("");}}>Retry after review</Button>
          {job.status === "Uncertain" && <Button size="sm" variant="ghost" onClick={() => {setReview({job, confirm: true}); setReason("");}}>Confirm existing print</Button>}
        </>}
      </div>)}
    </div>}
    {review && <dialog ref={dialog} onCancel={() => setReview(null)} className="m-auto max-w-lg rounded-lg bg-surface p-5 text-on-background backdrop:bg-black/40">
      {error && <p role="alert" className="text-error">{error}</p>}
      <h3 className="font-semibold">{review.confirm ? "Confirm existing print" : "Retry after review"}</h3>
      <p>{review.confirm ? "Verify the existing paper copy. This will not print again." : "Check for an existing paper copy first. Retrying may print a duplicate."}</p>
      <div className="my-2 flex gap-2">{(review.confirm ? ["Verified on rail"] : ["Paper jam", "Out of paper"]).map(text => <Button key={text} size="sm" variant="ghost" onClick={() => setReason(text)}>{text}</Button>)}</div>
      <textarea aria-label="Review reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="w-full border p-2" />
      <Button disabled={!reason.trim() || retry.loading || confirm.loading} onClick={() => {
        void (review.confirm ? confirm : retry).call({name: review.job.name, reason}).then(() => {setReview(null); void result.mutate();}).catch((caught: Error) => setError(caught.message));
      }}>{review.confirm ? "Confirm existing print" : "Retry after review"}</Button>
      <Button variant="ghost" disabled={retry.loading || confirm.loading} onClick={() => setReview(null)}>Cancel</Button>
    </dialog>}
  </div>;
}
