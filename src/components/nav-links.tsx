"use client";

import { usePathname } from "@/spa/compat/navigation";
import { Clapperboard, Library, Settings } from "lucide-react";
import { GuardedLink } from "@/components/guarded-link";
import { cn } from "@core/client/utils";

const ITEMS = [
  {
    href: "/projects",
    label: "项目",
    icon: Clapperboard,
    match: (p: string) => p.startsWith("/projects"),
  },
  {
    href: "/library/assets",
    label: "资源库",
    icon: Library,
    match: (p: string) => p.startsWith("/library"),
  },
  {
    href: "/settings",
    label: "设置",
    icon: Settings,
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function NavLinks({
  orientation = "horizontal",
  group = "all",
}: {
  orientation?: "horizontal" | "vertical" | "bottom";
  group?: "all" | "main" | "settings";
}) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  const bottom = orientation === "bottom";
  const items = ITEMS.filter((item) =>
    group === "all"
      ? true
      : group === "settings"
        ? item.href === "/settings"
        : item.href !== "/settings",
  );
  return (
    <nav
      className={cn(
        "text-sm",
        bottom
          ? "grid grid-cols-3 gap-1"
          : vertical
            ? "flex flex-col gap-1"
            : "flex items-center gap-1",
      )}
    >
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <GuardedLink
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center font-medium transition-colors",
              bottom
                ? "flex-col gap-0.5 rounded-xl py-1.5 text-[11px]"
                : vertical
                  ? "w-full gap-2.5 rounded-xl px-3 py-2"
                  : "gap-1.5 rounded-full px-3 py-1.5",
              active
                ? bottom
                  ? "bg-primary/10 text-primary"
                  : "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4 shrink-0", bottom && "size-5")} />
            {item.label}
          </GuardedLink>
        );
      })}
    </nav>
  );
}
