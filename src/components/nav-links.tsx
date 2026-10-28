"use client";

import { usePathname } from "next/navigation";
import { Clapperboard, Library, ListChecks, Settings } from "lucide-react";
import { GuardedLink } from "@/components/guarded-link";
import { useGlobalJobs } from "@/components/global-jobs-provider";
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
    href: "/tasks",
    label: "任务",
    icon: ListChecks,
    match: (p: string) => p.startsWith("/tasks"),
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
  orientation?: "horizontal" | "vertical";
  group?: "all" | "main" | "settings";
}) {
  const pathname = usePathname();
  const { runningCount, hasFailure } = useGlobalJobs();
  const vertical = orientation === "vertical";
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
        vertical ? "flex flex-col gap-1" : "flex items-center gap-1",
      )}
    >
      {items.map((item) => {
        const active = item.match(pathname);
        const isTasks = item.href === "/tasks";
        return (
          <GuardedLink
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center font-medium transition-colors",
              vertical
                ? "w-full gap-2.5 rounded-xl px-3 py-2"
                : "gap-1.5 rounded-full px-3 py-1.5",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
            {isTasks && runningCount > 0 && (
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                  vertical && "ml-auto",
                  active
                    ? "bg-primary-foreground text-primary"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {runningCount}
              </span>
            )}
            {isTasks && runningCount === 0 && hasFailure && (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-destructive",
                  vertical && "ml-auto",
                )}
                title="最近有任务失败"
              />
            )}
          </GuardedLink>
        );
      })}
    </nav>
  );
}
