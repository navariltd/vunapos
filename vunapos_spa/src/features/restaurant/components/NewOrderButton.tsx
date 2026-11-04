import { Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useStartOrder } from "../hooks/useStartOrder";

// "New order" on the Floor and Orders pages: opens the service type picker.
export function NewOrderButton({ className }: { className?: string }) {
  const bootstrap = useBootstrapData();
  const startOrder = useStartOrder();
  const serviceTypes = bootstrap.data?.restaurant?.service_types ?? [];

  return (
    <Button
      size="sm"
      disabled={!serviceTypes.length}
      className={`shrink-0 gap-2 ${className ?? ""}`}
      onClick={() => {
        const service =
          serviceTypes.find((row) => row.is_default) || serviceTypes[0];
        if (service) startOrder(service);
      }}
    >
      <Plus className="size-4" aria-hidden="true" />
      <span>New order</span>
    </Button>
  );
}
