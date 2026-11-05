/** One gate for menu loading, scans, variants and ordinary dine-in item entry. */
export function tableSelectionRequired(
  requiresTable: boolean | undefined,
  table?: string | null
): boolean {
  return Boolean(requiresTable && !table?.trim());
}
