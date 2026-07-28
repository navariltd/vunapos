import { useEffect, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "./Button";

type ConfirmDialogProps = {
	cancelLabel?: string;
	children?: ReactNode;
	confirmLabel?: string;
	danger?: boolean;
	description: string;
	isOpen: boolean;
	loading?: boolean;
	hideCancel?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	size?: "md" | "lg";
	title: string;
};

export function ConfirmDialog({ cancelLabel = "Cancel", children, confirmLabel = "Confirm", danger = false, description, hideCancel = false, isOpen, loading = false, onCancel, onConfirm, size = "md", title }: ConfirmDialogProps) {
	useEffect(() => {
		if (!isOpen) return;
		const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !loading) onCancel(); };
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [isOpen, loading, onCancel]);
	if (!isOpen) return null;
	return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 animate-fade-in" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onCancel(); }}><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" className={`flex w-full flex-col rounded-xl border border-outline-variant bg-surface shadow-xl ${size === "lg" ? "min-h-[28rem] max-w-2xl p-6" : "max-w-lg p-5"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 rounded-full p-2 ${danger ? "bg-error-container text-error" : "bg-tertiary-container text-on-tertiary-container"}`}><AlertTriangle className="size-5" /></span><div className="min-w-0 flex-1"><h2 id="confirm-dialog-title" className="text-lg font-semibold">{title}</h2><p id="confirm-dialog-description" className="mt-1 text-sm text-on-surface-variant">{description}</p></div><button type="button" className="rounded p-1 text-on-surface-variant hover:bg-surface-container" disabled={loading} onClick={onCancel} aria-label="Close dialog"><X className="size-5" /></button></div>{children ? <div className="mt-4 rounded-lg bg-surface-container-low p-4">{children}</div> : null}<div className="mt-auto flex justify-end gap-2 pt-5">{hideCancel ? null : <Button variant="ghost" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>}<Button variant={danger ? "danger" : "primary"} disabled={loading} onClick={onConfirm}>{loading ? "Please wait…" : confirmLabel}</Button></div></div></div>;
}
