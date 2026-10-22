"use client";

import { usePathname } from "next/navigation";
import { GuardedLink } from "@/components/guarded-link";
import { NextStepLink } from "@/components/next-step";
import { cn } from "@core/client/utils";

const TABS = [
  { key: "story", label: "故事", next: { key: "script", label: "下一步：生成剧本" } },
  { key: "script", label: "剧本", next: { key: "assets", label: "下一步：生成资产" } },
  { key: "assets", label: "资产", next: { key: "storyboard", label: "下一步：生成分镜" } },
  { key: "storyboard", label: "分镜", next: { key: "compose", label: "下一步：合成成片" } },
  { key: "compose", label: "合成" },
] as const;

export function ProjectTabs({
  seriesId,
  episodeId,
}: {
  seriesId: string;
  episodeId: string;
}) {
  const pathname = usePathname();
  const active = TABS.find(
    (tab) => pathname === `/projects/${seriesId}/${episodeId}/${tab.key}`,
  );
  const nextStep = active && "next" in active ? active.next : null;

  return (
    <div className="flex items-center justify-between gap-3">
      <nav className="inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1">
        {TABS.map((tab) => {
          const href = `/projects/${seriesId}/${episodeId}/${tab.key}`;
          const isActive = pathname === href;
          return (
            <GuardedLink
              key={tab.key}
              href={href}
              skipGuard={isActive}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </GuardedLink>
          );
        })}
      </nav>
      {nextStep && (
        <div className="hidden shrink-0 sm:block">
          <NextStepLink
            href={`/projects/${seriesId}/${episodeId}/${nextStep.key}`}
            label={nextStep.label}
          />
        </div>
      )}
    </div>
  );
}
