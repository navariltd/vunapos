import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Button } from "../../../components/ui/Button";
import { Sheet } from "../../../components/ui/Sheet";

type Summary = {
  items: {
    item_code: string;
    item_name: string;
    uom: string;
    remaining: number;
  }[];
  partial: boolean;
};
type Props = { posProfile: string; station: string; revision?: string };

export function AllDaySummary(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <ClipboardList className="mr-2 size-4" aria-hidden="true" />
        Items to prepare
      </Button>
      <Sheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Items to prepare"
        size="wide"
      >
        {open && <PendingItems {...props} />}
      </Sheet>
    </>
  );
}

function PendingItems({ posProfile, station, revision }: Props) {
  const result = useFrappeGetCall<{ message: Summary }>(
    "vunapos.api.kitchen_printing.all_day",
    { pos_profile: posProfile, station: station || undefined },
    `all-day:${posProfile}:${station}`,
    { refreshInterval: 15000 }
  );
  const refresh = result.mutate;
  useEffect(() => {
    void refresh();
  }, [revision, refresh]);
  return (
    <div className="space-y-4">
      {result.error ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-error">
            Unable to refresh quantities. Try again before using these totals.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : !result.data ? (
        <p role="status" className="text-sm text-on-surface-variant">
          Loading quantities…
        </p>
      ) : (
        <>
          {result.data.message.partial && (
            <p role="alert" className="text-sm text-error">
              Partial total: only the first 1,000 tickets are included.
            </p>
          )}
          {result.data.message.items.length ? (
            <table className="w-full text-left text-sm sm:text-base">
              <thead className="border-b border-outline-variant text-on-surface-variant">
                <tr>
                  <th scope="col" className="pb-2 font-medium">
                    Item
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    To prepare
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {result.data.message.items.map((item) => (
                  <tr key={`${item.item_code}:${item.uom}`}>
                    <td className="py-3 pr-4">{item.item_name}</td>
                    <td className="py-3 text-right tabular-nums">
                      <span className="font-semibold">
                        {item.remaining.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>{" "}
                      <span className="text-on-surface-variant">
                        {item.uom}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-center text-sm text-on-surface-variant">
              No items waiting for preparation.
            </p>
          )}
        </>
      )}
    </div>
  );
}
