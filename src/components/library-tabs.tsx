"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "styles", label: "风格库" },
  { key: "templates", label: "厂商提示词模板库" },
  { key: "skills", label: "技能库" },
];

export function LibraryTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const href = `/library/${tab.key}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
