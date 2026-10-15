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

export function ProjectTabs({
  seriesId,
  episodeId,
}: {
  seriesId: string;
  episodeId: string;
}) {
  const pathname = usePathname();
  return (
    <nav className="inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1">
      {TABS.map((tab) => {
        const href = `/projects/${seriesId}/${episodeId}/${tab.key}`;
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
