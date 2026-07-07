import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
	return (
		<div
			className={cn("rounded-lg border border-outline-variant bg-surface p-5 shadow-sm", className)}
			{...props}
		/>
	);
}
