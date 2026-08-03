import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-10 text-center">
      <div>
        <h2 className="text-2xl font-semibold text-on-surface">{title}</h2>
        <p className="mt-2 text-sm text-on-surface-variant">{description}</p>
      </div>
      {action}
    </div>
  );
}
