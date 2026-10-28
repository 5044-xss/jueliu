"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  CopyPlus,
  Library,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { PreviewImage } from "@/components/preview-image";
import { EmptyState } from "@/components/empty-state";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import type { LibraryAssetItem } from "@core/shared/library/assets";

const TYPE_LABEL: Record<string, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

const TYPE_ORDER = ["character", "scene", "prop"];

function imageUrl(item: LibraryAssetItem): string {
  const params = new URLSearchParams({ scope: item.scope });
  if (item.seriesId) params.set("seriesId", item.seriesId);
  return `/api/library/assets/${item.id}/image?${params.toString()}`;
}

function ImportGlobalDialog({
  seriesId,
  onImported,
  onOpenChange,
}: {
  seriesId: string;
  onImported: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<LibraryAssetItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/library/assets?scope=global", {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled) {
          setItems((data.assets ?? []) as LibraryAssetItem[]);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items ?? [];
    return (items ?? []).filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );
  }, [items, query]);

  async function copy(item: LibraryAssetItem) {
    setBusy(item.id);
    try {
      const res = await fetch(`/api/library/assets/${item.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "导入失败");
      setImported((current) => new Set(current).add(item.id));
      onImported();
      toast.success(`已导入「${item.name}」`);
    } catch (error) {
      toast.error((error as Error).message || "导入失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>从全局资产库导入</DialogTitle>
          <DialogDescription>
            把全局条目复制进本项目资产库，之后可在本项目各集直接复用。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索全局资产"
              className="h-8 pl-8 text-sm"
              aria-label="搜索全局资产"
            />
          </div>

          {items === null ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              {items.length === 0
                ? "全局资产库还是空的。"
                : "没有匹配的全局资产。"}
            </div>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {filtered.map((item) => {
                const done = imported.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1.5 rounded-lg border p-2"
                  >
                    <PreviewImage
                      src={imageUrl(item)}
                      alt={item.name}
                      className="h-24 w-full rounded bg-muted/30 object-contain"
                    />
                    <span className="truncate text-xs font-medium">
                      {item.name}
                      {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {TYPE_LABEL[item.type] ?? item.type}
                      {item.sourceSeriesName
                        ? ` · 来自 ${item.sourceSeriesName}`
                        : ""}
                    </span>
                    <Button
                      size="xs"
                      variant={done ? "ghost" : "outline"}
                      disabled={busy !== null || done}
                      onClick={() => copy(item)}
                    >
                      {busy === item.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : done ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <CopyPlus className="size-3" />
                      )}
                      {done ? "已导入" : "导入"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AssetLibraryBrowser({
  scope,
  seriesId,
  fill = false,
}: {
  scope: "global" | "project";
  seriesId?: string;
  fill?: boolean;
}) {
  const [items, setItems] = useState<LibraryAssetItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const confirm = useConfirm();

  const listUrl =
    scope === "global"
      ? "/api/library/assets?scope=global"
      : `/api/library/assets?scope=project&seriesId=${seriesId}`;

  const reload = useCallback(async () => {
    const res = await fetch(listUrl);
    const data = await res.json();
    return (data.assets ?? []) as LibraryAssetItem[];
  }, [listUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await reload();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (items ?? []).filter((item) => {
      if (type !== "all" && item.type !== type) return false;
      if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [items, query, type]);

  async function remove(item: LibraryAssetItem) {
    const label = scope === "global" ? "全局资产库" : "项目资产库";
    if (
      !(await confirm({
        title: "删除资产",
        description: `确定从${label}删除「${item.name}」？此操作不可恢复。`,
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/library/assets/${item.id}?scope=${scope}${
          scope === "project" ? `&seriesId=${seriesId}` : ""
        }`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await readError(res, "删除失败"));
      toast.success("已删除");
      setItems(await reload().catch(() => []));
    } catch (error) {
      toast.error((error as Error).message || "删除失败");
    }
  }

  const importDialog =
    importOpen && seriesId ? (
      <ImportGlobalDialog
        seriesId={seriesId}
        onImported={() => {
          void reload().then(setItems);
        }}
        onOpenChange={setImportOpen}
      />
    ) : null;

  if (items === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={fill ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}
      >
        <EmptyState
          icon={Library}
          tone={scope === "global" ? "mint" : "lime"}
          className={fill ? "min-h-0 flex-1 justify-center" : undefined}
          title={`${scope === "global" ? "全局" : "项目"}资产库还是空的`}
          description={
            scope === "global"
              ? "在项目「资产」页把已回传的参考图加入全局资产库后，可供所有剧复用。"
              : "在项目「资产」页把已回传的参考图加入项目资产库后，会显示在这里。"
          }
          action={
            scope === "project" && seriesId ? (
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                disabled={!seriesId}
              >
                <CopyPlus className="size-4" />
                从全局导入
              </Button>
            ) : undefined
          }
        />
        {importDialog}
      </div>
    );
  }

  const matched = filtered.length;
  const filtering = query.trim() !== "" || type !== "all";

  return (
    <div
      className={
        fill ? "flex min-h-0 flex-1 flex-col gap-3" : "flex flex-col gap-3"
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索资产名称"
            className="h-8 pl-8 text-sm"
            aria-label="搜索资产名称"
          />
        </div>
        <SelectField
          value={type}
          onChange={setType}
          className="w-28"
          aria-label="资产类型"
          options={[
            { value: "all", label: "全部" },
            ...TYPE_ORDER.map((key) => ({
              value: key,
              label: TYPE_LABEL[key] ?? key,
            })),
          ]}
        />
        <span className="text-xs text-muted-foreground">
          共 {items.length} 个
          {filtering ? ` · 匹配 ${matched} 个` : ""}
        </span>
        {scope === "project" && seriesId && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            onClick={() => setImportOpen(true)}
          >
            <CopyPlus className="size-3.5" />
            从全局导入
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className={
            fill
              ? "flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground"
              : "flex flex-col items-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground"
          }
        >
          <p>
            {query.trim()
              ? `没有匹配「${query.trim()}」的资产。`
              : "当前分类下没有资产。"}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setType("all");
            }}
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            清空筛选
          </button>
        </div>
      ) : (
        <div
          className={
            fill
              ? "min-h-0 flex-1 overflow-y-auto pr-1"
              : "h-[60vh] min-h-64 overflow-y-auto pr-1"
          }
        >
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {filtered.map((item) => (
              <Card key={item.id} size="sm" className="border border-border">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="truncate text-xs font-medium"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px]"
                      >
                        {TYPE_LABEL[item.type] ?? item.type}
                      </Badge>
                    </div>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => remove(item)}
                      title="从资产库删除"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  {item.variantLabel && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      变体 · {item.variantLabel}
                    </span>
                  )}
                  {item.scope === "global" && item.sourceSeriesName && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      来自 {item.sourceSeriesName}
                    </span>
                  )}
                  <PreviewImage
                    src={imageUrl(item)}
                    alt={item.name}
                    className="h-28 w-full rounded-md bg-muted/30 object-contain"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {importDialog}
    </div>
  );
}
