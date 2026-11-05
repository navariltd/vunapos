import { useEffect, useState } from "react";
import {
  Ellipsis,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
} from "lucide-react";

import { cn } from "../../lib/cn";
import {
  getPosPagePath,
  navigateToPosPage,
  useNavigationStore,
} from "../../lib/stores/navigationStore";
import {
  bottomNavItems,
  isItemActive,
  sidebarFooterItems,
  sidebarItems,
  type NavFeatureFlags,
  type PosMode,
} from "./navItems";

export type { NavFeatureFlags, PosMode } from "./navItems";

const activeLinkClass =
  "border border-primary bg-primary text-on-primary shadow-sm dark:bg-primary dark:text-on-primary";
const inactiveLinkClass =
  "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface";

type SidebarProps = {
  cashier?: string;
  features?: NavFeatureFlags;
  mode?: PosMode;
  posProfile?: string;
  warehouse?: string;
};

export function Sidebar({
  cashier,
  features,
  mode = "Retail",
  posProfile,
  warehouse,
}: SidebarProps) {
  const activePage = useNavigationStore((s) => s.activePage);
  const navItems = sidebarItems(features, mode);
  const footerItems = sidebarFooterItems(features, mode);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return window.localStorage.getItem("vunapos_sidebar_collapsed") === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(
      "vunapos_sidebar_collapsed",
      String(isCollapsed)
    );
  }, [isCollapsed]);

  return (
    <aside
      className={cn(
        "hidden border-r border-outline-variant bg-surface-container-low p-2 transition-[width] lg:flex lg:flex-col",
        isCollapsed ? "w-[72px]" : "w-60"
      )}
    >
      <nav className="space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item, activePage);
          return (
            <a
              key={item.label}
              href={getPosPagePath(item.label)}
              title={isCollapsed ? item.title : undefined}
              className={cn(
                "flex h-touch w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors",
                isActive ? activeLinkClass : inactiveLinkClass,
                isCollapsed && "justify-center px-0"
              )}
              onClick={(event) => {
                event.preventDefault();
                navigateToPosPage(item.label);
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              {isCollapsed ? null : <span>{item.title}</span>}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto space-y-1 border-t border-outline-variant pt-2">
        <button
          type="button"
          className={cn(
            "flex h-touch w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
            isCollapsed && "justify-center px-0"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setIsCollapsed((current) => !current)}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
          {isCollapsed ? null : <span>Collapse</span>}
        </button>
        {footerItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href={getPosPagePath(item.label)}
              title={isCollapsed ? item.title : undefined}
              className={cn(
                "flex h-touch w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors",
                isItemActive(item, activePage)
                  ? activeLinkClass
                  : inactiveLinkClass,
                isCollapsed && "justify-center px-0"
              )}
              onClick={(event) => {
                event.preventDefault();
                navigateToPosPage(item.label);
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              {isCollapsed ? null : <span>{item.title}</span>}
            </a>
          );
        })}
        <a
          href={getPosPagePath("Profile")}
          title={isCollapsed ? cashier || "User Profile" : undefined}
          className={cn(
            "flex min-h-touch w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
            activePage === "Profile" ? activeLinkClass : inactiveLinkClass,
            isCollapsed && "justify-center px-0"
          )}
          onClick={(event) => {
            event.preventDefault();
            navigateToPosPage("Profile");
          }}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              activePage === "Profile"
                ? "bg-on-primary/15 text-on-primary"
                : "bg-primary-container text-on-primary-container"
            )}
          >
            <UserRound className="size-4" />
          </span>
          {isCollapsed ? null : (
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate font-medium",
                  activePage === "Profile" ? "text-inherit" : "text-on-surface"
                )}
              >
                {cashier || "Cashier"}
              </span>
              <span
                className={cn(
                  "block truncate text-xs",
                  activePage === "Profile"
                    ? "text-inherit opacity-80"
                    : "text-on-surface-variant"
                )}
              >
                {posProfile || "No POS Profile"}
                {warehouse ? ` · ${warehouse}` : ""}
              </span>
            </span>
          )}
        </a>
      </div>
    </aside>
  );
}

export function BottomNav({
  features,
  mode = "Retail",
}: {
  features?: NavFeatureFlags;
  mode?: PosMode;
}) {
  const activePage = useNavigationStore((s) => s.activePage);
  const navItems = bottomNavItems(features, mode);
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryItems = navItems.length > 5 ? navItems.slice(0, 4) : navItems;
  const secondaryItems = navItems.length > 5 ? navItems.slice(4) : [];

  useEffect(() => {
    const unsubscribe = useNavigationStore.subscribe(() => setMoreOpen(false));
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", dismiss);
    };
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface px-2 pb-2 pt-1 lg:hidden">
      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Close more navigation"
            className="fixed inset-0 -z-10 bg-black/20"
            onClick={() => setMoreOpen(false)}
          />
          <div
            id="pos-more-navigation"
            className="absolute bottom-full right-2 mb-2 w-56 rounded-xl border border-outline-variant bg-surface p-2 shadow-xl"
          >
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.label}
                  href={getPosPagePath(item.label)}
                  className={cn(
                    "flex min-h-touch items-center gap-3 rounded-md px-3 text-sm",
                    isItemActive(item, activePage)
                      ? activeLinkClass
                      : inactiveLinkClass
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    setMoreOpen(false);
                    navigateToPosPage(item.label);
                  }}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.title}
                </a>
              );
            })}
          </div>
        </>
      ) : null}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${
            primaryItems.length + (secondaryItems.length ? 1 : 0)
          }, minmax(0, 1fr))`,
        }}
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item, activePage);
          return (
            <a
              key={item.label}
              href={getPosPagePath(item.label)}
              className={cn(
                "flex min-h-touch flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium transition-colors",
                isActive
                  ? activeLinkClass
                  : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
              )}
              onClick={(event) => {
                event.preventDefault();
                navigateToPosPage(item.label);
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label === "Orders" ? item.title : item.label}</span>
            </a>
          );
        })}
        {secondaryItems.length ? (
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="pos-more-navigation"
            className={cn(
              "flex min-h-touch flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium",
              moreOpen ||
                secondaryItems.some((item) => isItemActive(item, activePage))
                ? activeLinkClass
                : inactiveLinkClass
            )}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <Ellipsis className="size-4" aria-hidden="true" />
            <span>More</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
