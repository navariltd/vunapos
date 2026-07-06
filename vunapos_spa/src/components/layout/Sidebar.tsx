import { useEffect, useState } from "react";
import {
	CreditCard,
	Home,
	LogOut,
	PanelLeftClose,
	PanelLeftOpen,
	ReceiptText,
	Users,
} from "lucide-react";

import { cn } from "../../lib/cn";

const items = [
	{ label: "Home", icon: Home },
	{ label: "Invoices", icon: ReceiptText },
	{ label: "Payments", icon: CreditCard },
	{ label: "Customers", icon: Users },
	{ label: "Close Shift", icon: LogOut },
];

type NavPage = (typeof items)[number]["label"];

function handleNavAction(label: string) {
	window.dispatchEvent(new CustomEvent("vunapos_nav", { detail: { page: label } }));
}

function useActiveNavPage() {
	const [activePage, setActivePage] = useState<NavPage>("Home");

	useEffect(() => {
		const handleNav = (event: Event) => {
			const page = (event as CustomEvent<{ page?: NavPage }>).detail?.page;
			if (page) {
				setActivePage(page);
			}
		};

		window.addEventListener("vunapos_nav", handleNav);
		return () => window.removeEventListener("vunapos_nav", handleNav);
	}, []);

	return activePage;
}

export function Sidebar() {
	const activePage = useActiveNavPage();
	const [isCollapsed, setIsCollapsed] = useState(() => {
		return window.localStorage.getItem("vunapos_sidebar_collapsed") === "true";
	});

	useEffect(() => {
		window.localStorage.setItem("vunapos_sidebar_collapsed", String(isCollapsed));
	}, [isCollapsed]);

	return (
		<aside
			className={cn(
				"hidden border-r border-outline-variant bg-surface p-3 transition-[width] lg:flex lg:flex-col",
				isCollapsed ? "w-[72px]" : "w-60",
			)}
		>
			<nav className="space-y-1">
				{items.map((item) => {
					const Icon = item.icon;
					const isActive = item.label === activePage;
					return (
						<button
							key={item.label}
							type="button"
							title={isCollapsed ? item.label : undefined}
							className={cn(
								"flex h-touch w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium hover:bg-surface-container-low",
								isActive
									? "bg-primary text-on-primary shadow-sm hover:bg-primary"
									: "text-on-surface-variant hover:text-on-surface",
								isCollapsed && "justify-center px-0",
							)}
							onClick={() => handleNavAction(item.label)}
						>
							<Icon className="size-4" aria-hidden="true" />
							{isCollapsed ? null : <span>{item.label}</span>}
						</button>
					);
				})}
			</nav>
			<div className="mt-auto border-t border-outline-variant pt-3">
				<button
					type="button"
					className={cn(
						"flex h-touch w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
						isCollapsed && "justify-center px-0",
					)}
					title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={() => setIsCollapsed((current) => !current)}
				>
					{isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
					{isCollapsed ? null : <span>Collapse</span>}
				</button>
			</div>
		</aside>
	);
}

export function BottomNav() {
	const activePage = useActiveNavPage();

	return (
		<nav className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface px-2 pb-2 pt-1 lg:hidden">
			<div className="grid grid-cols-5 gap-1">
				{items.map((item) => {
					const Icon = item.icon;
					const isActive = item.label === activePage;
					return (
						<button
							key={item.label}
							type="button"
							className={cn(
								"flex min-h-touch flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium",
								isActive
									? "bg-primary text-on-primary"
									: "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
							)}
							onClick={() => handleNavAction(item.label)}
						>
							<Icon className="size-4" aria-hidden="true" />
							<span className="max-w-full truncate">{item.label}</span>
						</button>
					);
				})}
			</div>
		</nav>
	);
}
