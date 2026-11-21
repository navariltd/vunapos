import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import type { KitchenTicketDTO } from "../types";
export function KitchenNotes({ticket, refresh}: {ticket: KitchenTicketDTO; refresh: () => void}) {
  const [line, setLine] = useState("");
  const [note, setNote] = useState("");
  const [before, setBefore] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const call = useFrappePostCall("vunapos.api.kitchen_printing.update_preparation_notes");
  return <details className="border border-outline-variant p-3"><summary>Update preparation notes</summary>
    <select aria-label="Item to correct" value={line} onChange={e => {
      const row = ticket.items.find(row => row.line_id === e.target.value);
      setLine(e.target.value); setNote(row?.note || ""); setBefore(row?.note || ""); setKey(crypto.randomUUID());
    }}><option value="">Select item</option>{ticket.items.map(row => <option key={row.line_id} value={row.line_id}>{row.item_name}</option>)}</select>
    <textarea aria-label="Preparation notes" maxLength={1000} value={note} onChange={e => {setNote(e.target.value); setKey(crypto.randomUUID());}} />
    <p className="text-sm">Saves a correction for the kitchen. The original ticket stays unchanged.</p>
    <Button disabled={!line || call.loading} onClick={() => {
      setError(""); void call.call({ticket: ticket.name, line_id: line, note, expected_note: before, request_key: key})
        .then(() => {setLine(""); refresh();}).catch((e: Error) => setError(e.message));
    }}>Update preparation notes</Button>{error && <p role="alert">{error}</p>}
  </details>;
}
