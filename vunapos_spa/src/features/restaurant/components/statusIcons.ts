import { Check, Users, type LucideIcon } from "lucide-react";

import type { TableStatusKind } from "../tableStatus";

// One icon per status, shown in the legend and on tables too small for the
// status text, so status never relies on colour alone.
export const STATUS_ICON: Record<TableStatusKind, LucideIcon> = {
  free: Check,
  occupied: Users,
};
