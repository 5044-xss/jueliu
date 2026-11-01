"use client";

import Link from "@/spa/compat/link";
import { usePathname } from "@/spa/compat/navigation";
import { cn } from "@core/client/utils";

const TABS = [
  { key: "assets", label: "资产库" },
  { key: "styles", label: "风格库" },
  { key: "skills", label: "技能库" },
];

export function LibraryTabs() {
  const pathname = usePathname();
  return (
    <nav className="inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1">
      {TABS.map((tab) => {
        const href = `/library/${tab.key}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
