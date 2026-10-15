"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PreviewImage } from "@/components/preview-image";
import type { LibraryAssetItem } from "@/lib/library/assets";

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
}: {
  scope: "global" | "project";
  seriesId?: string;
}) {
  const [items, setItems] = useState<LibraryAssetItem[] | null>(null);

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

  async function remove(item: LibraryAssetItem) {
    const label = scope === "global" ? "全局资产库" : "项目资产库";
    if (!window.confirm(`确定从${label}删除「${item.name}」？`)) return;
    try {
      const res = await fetch(
        `/api/library/assets/${item.id}?scope=${scope}${
          scope === "project" ? `&seriesId=${seriesId}` : ""
        }`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      toast.success("已删除");
      setItems(await reload().catch(() => []));
    } catch {
      toast.error("删除失败");
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
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {scope === "global" ? "全局" : "项目"}资产库还是空的。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.id} className="border border-border">
          <CardContent className="flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {TYPE_LABEL[item.type] ?? item.type}
                </Badge>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => remove(item)}
                title="从资产库删除"
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            {item.variantLabel && (
              <span className="text-xs text-muted-foreground">
                妆造 · {item.variantLabel}
              </span>
            )}
            <PreviewImage
              src={imageUrl(item)}
              alt={item.name}
              className="max-h-52 w-full rounded-md object-contain"
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
