"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { EpisodePickerDialog } from "@/components/episode-picker-dialog";
import { ExportDialog, type ExportMode } from "@/components/export-dialog";
import { HelpDialog } from "@/components/help-dialog";
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
import { SelectField } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { CopyDialog } from "@/components/copy-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { ASPECT_OPTIONS, DEFAULT_ASPECT_RATIO } from "@/lib/aspect";
import { readError } from "@/lib/http";
import type { LibraryStyle } from "@core/shared/library/types";
import type { SeriesWithCount } from "@core/shared/projects";

interface SaveFileHandle {
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

function zipFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${(cleaned || "项目").slice(0, 60)}.zip`;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [series, setSeries] = useState<SeriesWithCount[] | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "create" | "rename"; id?: string; original?: string } | null
  >(null);
  const [nameDraft, setNameDraft] = useState("");
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [styleIdDraft, setStyleIdDraft] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [aspectDraft, setAspectDraft] = useState(DEFAULT_ASPECT_RATIO);
  const [saving, setSaving] = useState(false);
  const [copyTarget, setCopyTarget] = useState<SeriesWithCount | null>(null);
  const [copying, setCopying] = useState(false);
  const [exportTarget, setExportTarget] = useState<SeriesWithCount | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [episodePicker, setEpisodePicker] = useState<SeriesWithCount | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const filteredSeries = useMemo(() => {
    const list = series ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );
  }, [series, query]);

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/styles")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStyles((data.styles ?? []) as LibraryStyle[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setNameDraft("");
    setStyleIdDraft("");
    setStyleDraft("");
    setAspectDraft(DEFAULT_ASPECT_RATIO);
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
        const chosen = styles.find((item) => item.id === styleIdDraft);
        const customStyle = styleDraft.trim();
        const stylePatch = chosen
          ? {
              styleId: chosen.id,
              style: chosen.prompt,
              videoStyle: chosen.videoStyle ?? "",
            }
          : customStyle
            ? { styleId: null, style: customStyle }
            : {};
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            aspectRatio: aspectDraft,
            ...stylePatch,
          }),
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

  async function doExport(mode: ExportMode) {
    if (!exportTarget || exporting) return;
    const target = exportTarget;
    const fileName = zipFileName(target.name);
    const picker = (
      window as unknown as { showSaveFilePicker?: SaveFilePicker }
    ).showSaveFilePicker;
    let handle: SaveFileHandle | null = null;
    if (picker) {
      try {
        handle = await picker({
          suggestedName: fileName,
          types: [
            {
              description: "Zip 压缩包",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
      } catch (error) {
        if ((error as DOMException)?.name !== "AbortError") {
          toast.error((error as Error).message || "无法选择保存位置");
        }
        return;
      }
    }

    setExportTarget(null);
    setExporting(true);
    const toastId = toast.loading(`正在打包「${target.name}」…`);
    try {
      const res = await fetch(
        `/api/series/${target.id}/export?mode=${mode}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(await readError(res, "导出失败"));
      if (handle && res.body) {
        await res.body.pipeTo(await handle.createWritable());
      } else {
        saveBlob(await res.blob(), fileName);
      }
      toast.success(`「${target.name}」已导出`, { id: toastId });
    } catch (error) {
      toast.error((error as Error).message || "导出失败", { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  async function importArchive(file: File) {
    if (importing) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("请选择 zip 项目包");
      return;
    }
    setImporting(true);
    const toastId = toast.loading(`正在导入「${file.name}」…`);
    try {
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        series?: { id?: string; name?: string };
      } | null;
      if (!res.ok) throw new Error(data?.error || "导入失败");
      toast.success(`已导入「${data?.series?.name ?? file.name}」`, {
        id: toastId,
      });
      await reload();
      if (data?.series?.id) {
        router.push(`/projects/${data.series.id}`);
      }
    } catch (error) {
      toast.error((error as Error).message || "导入失败", { id: toastId });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-6">
      <PageHeader
        eyebrow="Projects"
        title="项目"
        description="一部剧对应一个项目，其下按集拆分为子集，本地存储于 workspace/。"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              导入项目
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </div>
        }
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importArchive(file);
        }}
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
              <Button
                variant="outline"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                导入项目
              </Button>
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                新建项目
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              查看使用说明
            </button>
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
                placeholder="搜索项目名称"
                className="h-8 pl-8 text-sm"
                aria-label="搜索项目名称"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              共 {series.length} 个项目
              {query.trim() ? ` · 匹配 ${filteredSeries.length} 个` : ""}
            </span>
          </div>

          {filteredSeries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground">
              <p>没有匹配「{query.trim()}」的项目。</p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-xs underline underline-offset-4 hover:text-foreground"
              >
                清空搜索
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-3">
              <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredSeries.map((s) => (
                  <Card key={s.id} className="border border-border">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-1">
                        <span className="truncate">{s.name}</span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="shrink-0 text-muted-foreground"
                          aria-label="导出项目"
                          title="导出项目"
                          onClick={() => setExportTarget(s)}
                        >
                          <Download className="size-3.5" />
                        </Button>
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
        <DialogContent className="sm:max-w-md">
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
          {dialog?.mode === "create" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="series-style">画面风格</Label>
                <SelectField
                  id="series-style"
                  value={styleIdDraft}
                  onChange={(value) => {
                    setStyleIdDraft(value);
                    const chosen = styles.find((item) => item.id === value);
                    if (chosen) setStyleDraft("");
                  }}
                  options={[
                    { value: "", label: "自定义" },
                    ...styles.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                />
                {!styleIdDraft && (
                  <Input
                    value={styleDraft}
                    onChange={(e) => setStyleDraft(e.target.value)}
                    placeholder="自定义风格提示词（可留空）"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  新建子集时会默认沿用这里的风格与比例。
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="series-aspect">画面比例</Label>
                <SelectField
                  id="series-aspect"
                  value={aspectDraft}
                  onChange={setAspectDraft}
                  options={ASPECT_OPTIONS.map((ratio) => ({
                    value: ratio,
                    label: ratio,
                  }))}
                />
              </div>
            </>
          )}
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

      {exportTarget && (
        <ExportDialog
          seriesName={exportTarget.name}
          busy={exporting}
          onClose={() => {
            if (!exporting) setExportTarget(null);
          }}
          onConfirm={doExport}
        />
      )}

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
