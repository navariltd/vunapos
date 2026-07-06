import type { ReactNode } from "react";

import { Header } from "./Header";
import { BottomNav, Sidebar } from "./Sidebar";

type AppShellProps = {
	children: ReactNode;
	cashier?: string;
	posProfile?: string;
	warehouse?: string;
};

export function AppShell({ cashier, children, posProfile, warehouse }: AppShellProps) {
	return (
		<div className="flex h-[100dvh] flex-col overflow-hidden bg-surface text-on-background">
			<Header cashier={cashier} posProfile={posProfile} warehouse={warehouse} />
			<div className="flex min-h-0 flex-1">
				<Sidebar />
				<main className="min-h-0 min-w-0 flex-1 bg-surface p-0">{children}</main>
			</div>
			<BottomNav />
		</div>
	);
}
