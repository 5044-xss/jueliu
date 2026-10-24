"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Library, Loader2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

function imageUrl(item: LibraryAssetItem): string {
  const params = new URLSearchParams({ scope: item.scope });
  if (item.seriesId) params.set("seriesId", item.seriesId);
  return `/api/library/assets/${item.id}/image?${params.toString()}`;
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
    if (!items || !keyword) return items ?? [];
    return items.filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );
  }, [items, query]);

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

  if (items === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
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
      />
    );
  }

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
        <span className="text-xs text-muted-foreground">
          共 {items.length} 个
          {query.trim() ? ` · 匹配 ${filtered.length} 个` : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div
          className={
            fill
              ? "flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground"
              : "flex flex-col items-center gap-1 rounded-2xl border bg-card py-14 text-center text-sm text-muted-foreground"
          }
        >
          <p>没有匹配「{query.trim()}」的资产。</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            清空搜索
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
    </div>
  );
}
