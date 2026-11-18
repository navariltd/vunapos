export const stockFieldClass =
  "min-w-0 rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary";
export function stockDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
export function stockQty(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
}
