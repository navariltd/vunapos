import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { useBootstrapData } from "../../pos/hooks/useBootstrapData";
import { useStartOrder } from "../hooks/useStartOrder";
import { ServiceTypePicker } from "./ServiceTypePicker";

// "New order" on the Floor and Orders pages: opens the service type picker.
export function NewOrderButton({ className }: { className?: string }) {
  const bootstrap = useBootstrapData();
  const startOrder = useStartOrder();
  const [open, setOpen] = useState(false);
  const serviceTypes = bootstrap.data?.restaurant?.service_types ?? [];

  return (
    <>
      <Button size="sm" className={`shrink-0 gap-2 ${className ?? ""}`} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        <span>New order</span>
      </Button>
      <ServiceTypePicker
        isOpen={open}
        serviceTypes={serviceTypes}
        onClose={() => setOpen(false)}
        onSelect={(serviceType) => {
          setOpen(false);
          startOrder(serviceType);
        }}
      />
    </>
  );
}
