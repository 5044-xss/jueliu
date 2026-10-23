"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { EpisodePickerDialog } from "@/components/episode-picker-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { CopyDialog } from "@/components/copy-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import type { SeriesWithCount } from "@core/shared/projects";

export default function HomePage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [series, setSeries] = useState<SeriesWithCount[] | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "create" | "rename"; id?: string; original?: string } | null
  >(null);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copyTarget, setCopyTarget] = useState<SeriesWithCount | null>(null);
  const [copying, setCopying] = useState(false);
  const [episodePicker, setEpisodePicker] = useState<SeriesWithCount | null>(
    null,
  );

  const reload = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error(await readError(res, "读取项目列表失败"));
    const data = await res.json();
    setSeries((data.series ?? []) as SeriesWithCount[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error(await readError(res, "读取项目列表失败"));
        const data = await res.json();
        if (cancelled) return;
        setSeries((data.series ?? []) as SeriesWithCount[]);
      } catch (error) {
        if (!cancelled) {
          toast.error((error as Error).message || "读取项目列表失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setNameDraft("");
    setDialog({ mode: "create" });
  }

  function openRename(s: SeriesWithCount) {
    setNameDraft(s.name);
    setDialog({ mode: "rename", id: s.id, original: s.name });
  }

  async function save() {
    if (!dialog) return;
    const name = nameDraft.trim();
    if (!name) {
      toast.error("请填写项目名");
      return;
    }
    setSaving(true);
    try {
      if (dialog.mode === "create") {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "创建失败");
        toast.success("项目已创建");
        setDialog(null);
        router.push(`/projects/${data.series.id}`);
      } else {
        const res = await fetch(`/api/series/${dialog.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "重命名失败");
        toast.success("项目已重命名");
        setDialog(null);
        await reload();
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: SeriesWithCount) {
    const count = s.episodeCount;
    if (
      !(await confirm({
        title: "删除项目",
        description:
          count > 0
            ? `确定删除项目「${s.name}」？其下 ${count} 个子集的本地数据与媒体文件将一并删除，且不可恢复。`
            : `确定删除项目「${s.name}」？此操作不可恢复。`,
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/series/${s.id}`, { method: "DELETE" });
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
      const res = await fetch(`/api/series/${copyTarget.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "复制失败");
      toast.success("项目已复制");
      setCopyTarget(null);
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <PageHeader
        eyebrow="Projects"
        title="项目"
        description="一部剧对应一个项目，其下按集拆分为子集，本地存储于 workspace/。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            新建项目
          </Button>
        }
      />

      {series === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : series.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex flex-col gap-1">
              <p className="font-medium">还没有项目</p>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                先在设置里填好模型 API Key，再新建项目，从故事一路做成成片。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/settings#llm" />}
              >
                去填写 API Key
              </Button>
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                新建项目
              </Button>
            </div>
            <Link
              href="/help"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              查看使用说明
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="pr-3 pb-3">
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {series.map((s) => (
              <Card key={s.id} className="border border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1">
                    <span className="truncate">{s.name}</span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground"
                      aria-label="重命名"
                      title="重命名"
                      onClick={() => openRename(s)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    创建于 {new Date(s.createdAt).toLocaleString("zh-CN")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-between gap-2"
                    disabled={s.episodes.length === 0}
                    onClick={() => setEpisodePicker(s)}
                  >
                    <span className="truncate">
                      {s.episodes.length > 0
                        ? `选择分集 · 共 ${s.episodes.length} 集`
                        : "暂无分集"}
                    </span>
                    <ChevronDown className="size-4 shrink-0 opacity-60" />
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => router.push(`/projects/${s.id}`)}
                    >
                      <FolderOpen className="size-4" />
                      打开
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setCopyTarget(s)}
                    >
                      <Copy className="size-4" />
                      复制
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => remove(s)}
                    >
                      <Trash2 className="size-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        首次使用请先到 <Link href="/settings" className="underline">设置</Link>{" "}
        配置 LLM；ffmpeg 一般已内置，合成报错时也可在设置中指定路径。
      </p>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "rename" ? "重命名项目" : "新建项目"}
            </DialogTitle>
            <DialogDescription>
              一部剧对应一个项目，进入项目后再按集新建子集。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="series-name">项目名</Label>
            <Input
              id="series-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="例如：城市广场的告白"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {dialog?.mode === "rename" ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {episodePicker && (
        <EpisodePickerDialog
          open
          onOpenChange={(open) => {
            if (!open) setEpisodePicker(null);
          }}
          seriesName={episodePicker.name}
          episodes={episodePicker.episodes}
          onSelect={(episode) =>
            router.push(`/projects/${episodePicker.id}/${episode.id}`)
          }
        />
      )}

      {copyTarget && (
        <CopyDialog
          title="复制项目"
          description="将连同其下所有子集、脚本、资产与生成的媒体一并复制为新项目。"
          label="新项目名"
          defaultName={`${copyTarget.name} 副本`}
          saving={copying}
          onClose={() => setCopyTarget(null)}
          onConfirm={doCopy}
        />
      )}
    </div>
  );
}
