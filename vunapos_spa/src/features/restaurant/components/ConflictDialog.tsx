import { Button } from "../../../components/ui/Button";
import type { ConflictLine } from "../menuConflicts";
import { Sheet } from "./Sheet";

export type ConflictPrompt = {
  title: string;
  description: string;
  lines: ConflictLine[];
  // The way back, e.g. "Choose another table" or "Keep Dine In".
  otherLabel: string;
  onRemove: () => void;
};

// Lines a table, service type or order can't take. Nothing is sent until the user
// removes them or goes back.
export function ConflictDialog({ prompt, onClose }: { prompt: ConflictPrompt | null; onClose: () => void }) {
  return (
    <Sheet
      isOpen={Boolean(prompt)}
      title={prompt?.title ?? ""}
      description={prompt?.description}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="h-11" onClick={onClose}>
            {prompt?.otherLabel}
          </Button>
          <Button
            className="h-11"
            onClick={() => {
              prompt?.onRemove();
              onClose();
            }}
          >
            Remove these items
          </Button>
        </div>
      }
    >
      <ul className="space-y-1 text-sm">
        {prompt?.lines.map((line) => (
          <li key={line.line_id} className="flex justify-between gap-3">
            <span className="min-w-0 break-words text-on-surface">{line.item_name}</span>
            <span className="shrink-0 tabular-nums text-on-surface-variant">× {line.qty}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
