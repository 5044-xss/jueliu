"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "story", label: "故事" },
  { key: "script", label: "剧本" },
  { key: "assets", label: "资产" },
  { key: "storyboard", label: "分镜" },
  { key: "compose", label: "合成" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const href = `/projects/${projectId}/${tab.key}`;
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
