"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/spa/compat/link";
import { useParams, useRouter } from "@/spa/compat/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  Copy,
  Film,
  FolderOpen,
  Library,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { OpenProjectFolderButton } from "@/components/workspace-actions";
import { ProjectFormDialog } from "@/components/project-form-dialog";
import { SeriesSwitcher } from "@/components/series-switcher";
import { CopyDialog } from "@/components/copy-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import type { EpisodeSummary, SeriesSummary } from "@core/shared/projects";

interface EpisodeCard extends EpisodeSummary {
  thumbnail: { segmentId: string } | null;
}

export default function SeriesPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [series, setSeries] = useState<SeriesSummary | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeCard[] | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [copyTarget, setCopyTarget] = useState<EpisodeSummary | null>(null);
  const [copying, setCopying] = useState(false);
  const [query, setQuery] = useState("");

  const filteredEpisodes = useMemo(() => {
    const list = episodes ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );
  }, [episodes, query]);

  const reload = useCallback(async () => {
    const [res, listRes] = await Promise.all([
      fetch(`/api/series/${seriesId}`),
      fetch("/api/projects"),
    ]);
    const data = await res.json();
    const listData = await listRes.json().catch(() => ({}));
    setSeries((data.series ?? null) as SeriesSummary | null);
    setSeriesList((listData.series ?? []) as SeriesSummary[]);
    setEpisodes((data.episodes ?? []) as EpisodeCard[]);
  }, [seriesId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, listRes] = await Promise.all([
          fetch(`/api/series/${seriesId}`),
          fetch("/api/projects"),
        ]);
        if (!res.ok) throw new Error(await readError(res, "读取项目失败"));
        const data = await res.json();
        const listData = await listRes.json().catch(() => ({}));
        if (cancelled) return;
        setSeries((data.series ?? null) as SeriesSummary | null);
        setSeriesList((listData.series ?? []) as SeriesSummary[]);
        setEpisodes((data.episodes ?? []) as EpisodeCard[]);
      } catch (error) {
        if (!cancelled) toast.error((error as Error).message || "读取项目失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  function openCreate() {
    setFormMode("create");
    setEditingId(undefined);
    setFormOpen(true);
  }

  function openEdit(episode: EpisodeSummary) {
    setFormMode("edit");
    setEditingId(episode.id);
    setFormOpen(true);
  }

  function handleSaved(project: { id: string }) {
    setFormOpen(false);
    if (formMode === "create") {
      router.push(`/projects/${seriesId}/${project.id}`);
    } else {
      reload();
    }
  }

  async function remove(id: string, name: string) {
    if (
      !(await confirm({
        title: "删除子集",
        description: `确定删除子集「${name}」？其本地数据与媒体文件将一并删除，且不可恢复。`,
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "删除失败"));
      toast.success("已删除");
      await reload();
    } catch (error) {
      toast.error((error as Error).message || "删除失败");
    }
  }

  async function doCopy(name: string) {
    if (!copyTarget) return;
    setCopying(true);
    try {
      const res = await fetch(`/api/projects/${copyTarget.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "复制失败");
      toast.success("子集已复制");
      setCopyTarget(null);
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/projects"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          项目
        </Link>
        <span className="text-muted-foreground/50">/</span>
        {series ? (
          seriesList.length > 0 ? (
            <SeriesSwitcher currentId={seriesId} series={seriesList} />
          ) : (
            <span className="text-foreground">{series.name}</span>
          )
        ) : (
          <span className="text-foreground">…</span>
        )}
      </div>

      <PageHeader
        eyebrow="Project"
        title={series ? series.name : "…"}
        description="项目下的所有子集（每集）在此管理。"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/projects/${seriesId}/assets`)}
            >
              <Library className="size-4" />
              项目资产库
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              新建子集
            </Button>
          </div>
        }
      />

      {episodes === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : episodes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            还没有子集，点击右上角「新建子集」开始。
          </CardContent>
        </Card>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索分集名称"
                className="h-8 pl-8 text-sm"
                aria-label="搜索分集名称"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              共 {episodes.length} 集
              {query.trim() ? ` · 匹配 ${filteredEpisodes.length} 集` : ""}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-3">
            {filteredEpisodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground">
                <p>没有匹配「{query.trim()}」的分集。</p>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-xs underline underline-offset-4 hover:text-foreground"
                >
                  清空搜索
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {filteredEpisodes.map((e) => (
                  <Card
                    key={e.id}
                    size="sm"
                    className="border border-border gap-0 p-0"
                  >
                    {e.thumbnail ? (
                      <div className="relative aspect-video w-full overflow-hidden bg-black">
                        <video
                          src={`/api/projects/${e.id}/segments/${e.thumbnail.segmentId}/video#t=0.1`}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground/60">
                        <Film className="size-6" />
                      </div>
                    )}
                    <CardHeader className="pt-(--card-spacing) pb-1.5">
                      <div className="flex min-w-0 items-center gap-1">
                        <CardTitle className="min-w-0 flex-1 truncate">
                          {e.name}
                        </CardTitle>
                        <OpenProjectFolderButton
                          projectId={e.id}
                          label=""
                          size="icon-xs"
                          variant="ghost"
                          className="shrink-0"
                        />
                      </div>
                      <CardDescription className="text-xs">
                        创建于 {new Date(e.createdAt).toLocaleString("zh-CN")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-4 items-center gap-1.5 pb-(--card-spacing)">
                      <Button
                        size="xs"
                        className="w-full px-1"
                        onClick={() =>
                          router.push(`/projects/${seriesId}/${e.id}`)
                        }
                      >
                        <FolderOpen className="size-3.5" />
                        打开
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        className="w-full px-1"
                        onClick={() => openEdit(e)}
                      >
                        <Pencil className="size-3.5" />
                        编辑
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        className="w-full px-1"
                        onClick={() => setCopyTarget(e)}
                      >
                        <Copy className="size-3.5" />
                        复制
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        className="w-full px-1"
                        onClick={() => remove(e.id, e.name)}
                      >
                        <Trash2 className="size-3.5" />
                        删除
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {formOpen && (
        <ProjectFormDialog
          key={formMode === "edit" ? `edit-${editingId}` : "create"}
          mode={formMode}
          projectId={editingId}
          seriesId={seriesId}
          defaults={
            series
              ? {
                  styleId: series.styleId ?? null,
                  style: series.style ?? "",
                  videoStyle: series.videoStyle ?? "",
                  aspectRatio: series.aspectRatio,
                }
              : undefined
          }
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {copyTarget && (
        <CopyDialog
          title="复制子集"
          description="将连同脚本、资产、分镜与生成的媒体一并复制为新子集。"
          label="新子集名"
          defaultName={`${copyTarget.name} 副本`}
          saving={copying}
          onClose={() => setCopyTarget(null)}
          onConfirm={doCopy}
        />
      )}
    </div>
  );
}
