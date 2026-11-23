import { useEffect, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
type Summary = {items: {item_code: string; item_name: string; uom: string; remaining: number}[]; partial: boolean};
export function AllDaySummary({posProfile, station, revision}: {posProfile: string; station: string; revision?: string}) {
  const [open, setOpen] = useState(false);
  const result = useFrappeGetCall<{message: Summary}>("vunapos.api.kitchen_printing.all_day", {pos_profile: posProfile, station: station || undefined}, open ? `all-day:${posProfile}:${station}` : null, {refreshInterval: 15000});
  const refresh = result.mutate;
  useEffect(() => { if (open) void refresh(); }, [open, revision, refresh]);
  return <details className="mb-3 rounded border border-outline-variant p-2" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>All-Day Items</summary>
    <p className="text-xs">Remaining to prepare across permitted open tickets in this station view. Check each ticket’s modifiers and notes before batching.</p>
    {result.error ? <p role="alert">Unable to refresh quantities.</p> : !result.data ? <p>Loading quantities…</p> : <>
      {result.data.message.partial && <p role="alert">Partial tally: first 1,000 tickets only.</p>}
      <div className="flex flex-wrap gap-2">{result.data.message.items.map(item => <span key={`${item.item_code}:${item.uom}`} className="rounded bg-surface-container px-2 py-1">{item.item_name}: {item.remaining} {item.uom}</span>)}</div>
      {!result.data.message.items.length && <p>No items waiting for preparation.</p>}
    </>}
  </details>;
}
