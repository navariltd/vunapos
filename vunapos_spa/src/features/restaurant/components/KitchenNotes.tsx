import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import type { KitchenTicketDTO } from "../types";
export function KitchenNotes({ticket, lineId, refresh}: {ticket: KitchenTicketDTO; lineId: string; refresh: () => void}) {
  const row = ticket.items.find(item => item.line_id === lineId)!;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [before, setBefore] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const call = useFrappePostCall<{message: {queued: boolean; unchanged?: boolean}}>("vunapos.api.kitchen_printing.update_preparation_notes");
  const disabled = (row.ready_qty || 0) > 0 || (row.cancelled_qty || 0) >= row.qty;
  return <div className="mt-2 text-sm">
    {!editing ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
      setEditing(true); setNote(row.note || ""); setBefore(row.note || ""); setKey(crypto.randomUUID()); setMessage(""); setError("");
    }}>Edit note</Button> : <div>
      <textarea aria-label={`Preparation notes for ${row.item_name}`} className="w-full rounded border p-2" maxLength={1000} disabled={call.loading} value={note} onChange={e => {setNote(e.target.value); setKey(crypto.randomUUID());}} />
      <Button size="sm" disabled={call.loading || disabled} onClick={() => {
        setError(""); void call.call({ticket: ticket.name, line_id: lineId, note, expected_note: before, request_key: key})
          .then(result => {setEditing(false); setMessage(result.message?.queued ? "Note updated & queued for kitchen printer" : result.message?.unchanged ? "No change to preparation notes" : "Note updated on kitchen screen; no print job queued"); refresh();})
          .catch((e: Error) => setError(e.message));
      }}>Save</Button>
      <Button size="sm" variant="ghost" disabled={call.loading} onClick={() => setEditing(false)}>Cancel</Button>
    </div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
