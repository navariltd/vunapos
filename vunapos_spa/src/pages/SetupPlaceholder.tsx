import { CheckCircle2 } from "lucide-react";

import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

const setupItems = [
  "Frappe React SDK configured",
  "Tailwind CSS v4 configured",
  "Inter font loaded",
  "Ready for POS home screen",
];

export function SetupPlaceholder() {
  return (
    <section className="mx-auto max-w-5xl">
      <EmptyState title="VunaPOS" description="Frontend foundation is ready." />
      <div className="grid gap-4 sm:grid-cols-2">
        {setupItems.map((item) => (
          <Card key={item} className="flex items-center gap-3">
            <CheckCircle2
              className="size-5 text-secondary"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-on-surface">{item}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
