"use client";

import { useEffect, useState } from "react";
import Link from "@/spa/compat/link";
import { useParams } from "@/spa/compat/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AssetLibraryBrowser } from "@/components/asset-library-browser";
import type { SeriesSummary } from "@core/shared/projects";

export default function ProjectAssetsPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const [series, setSeries] = useState<SeriesSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/series/${seriesId}`);
        const data = await res.json();
        if (!cancelled) setSeries((data.series ?? null) as SeriesSummary | null);
      } catch {
        if (!cancelled) setSeries(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-6">
      <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/projects"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          项目
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <Link
          href={`/projects/${seriesId}`}
          className="truncate hover:text-foreground"
        >
          {series ? series.name : "…"}
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground">资产库</span>
      </div>

      <PageHeader
        eyebrow="Project Library"
        accent="lime"
        title="项目资产库"
        description="本剧（系列）内所有子集共享的角色 / 场景 / 道具 / 妆造参考图。"
      />

      <AssetLibraryBrowser scope="project" seriesId={seriesId} fill />
    </div>
  );
}
