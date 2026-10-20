"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, ImagePlus, Library, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { readError } from "@/lib/http";
import type { LibraryAssetItem } from "@core/shared/library/assets";

const TYPE_LABEL: Record<string, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function libraryImageUrl(item: LibraryAssetItem): string {
  const params = new URLSearchParams({ scope: item.scope });
  if (item.seriesId) params.set("seriesId", item.seriesId);
  return `/api/library/assets/${item.id}/image?${params.toString()}`;
}

export function ImageSourceDialog({
  projectId,
  seriesId,
  viewId,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId: string;
  seriesId: string;
  viewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const [scope, setScope] = useState<"project" | "global">("project");
  const [items, setItems] = useState<LibraryAssetItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const url =
        scope === "global"
          ? "/api/library/assets?scope=global"
          : `/api/library/assets?scope=project&seriesId=${seriesId}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled) setItems((data.assets ?? []) as LibraryAssetItem[]);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope, seriesId]);

  async function submit(file: File) {
    if (!viewId) throw new Error("未选择要回传的视图");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/projects/${projectId}/assets/views/${viewId}/image`,
      { method: "POST", body: form },
    );
    if (!res.ok) throw new Error(await readError(res, "回传失败"));
  }

  async function onManual(file: File) {
    setBusy(true);
    try {
      await submit(file);
      toast.success("图片已回传");
      onUploaded();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || "回传失败");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPick(item: LibraryAssetItem) {
    setBusy(true);
    try {
      const res = await fetch(libraryImageUrl(item));
      if (!res.ok) throw new Error(await readError(res, "读取资产图失败"));
      const blob = await res.blob();
      const ext = blob.type.split("/")[1] || "png";
      await submit(
        new File([blob], `${item.name || "asset"}.${ext}`, {
          type: blob.type,
        }),
      );
      toast.success("图片已回传");
      onUploaded();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || "选择失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>回传图片</DialogTitle>
          <DialogDescription>
            手动上传，或从项目 / 全局资产库选择一张已保存的图直接复用。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !viewId}
          >
            <ImagePlus className="size-4" />
            手动上传
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onManual(file);
            }}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">或从资产库选择</span>
            <div className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted p-1">
              {(["project", "global"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setScope(s);
                    setItems(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    scope === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "project" ? "项目资产库" : "全局资产库"}
                </button>
              ))}
            </div>
          </div>

          {items === null ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              该资产库还没有图片，先在资产页点「入库」保存一张。
            </div>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPick(item)}
                  disabled={busy}
                  className="flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={libraryImageUrl(item)}
                    alt={item.name}
                    className="h-24 w-full rounded object-cover"
                  />
                  <span className="truncate text-xs font-medium">
                    {item.name}
                    {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {TYPE_LABEL[item.type] ?? item.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImageSourceButton({
  projectId,
  seriesId,
  viewId,
  onChanged,
  disabled,
}: {
  projectId: string;
  seriesId: string;
  viewId: string | null;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled || !viewId}
      >
        <ImagePlus className="size-3" />
        回传
      </Button>
      <ImageSourceDialog
        projectId={projectId}
        seriesId={seriesId}
        viewId={viewId}
        open={open}
        onOpenChange={setOpen}
        onUploaded={onChanged}
      />
    </>
  );
}

export function AddToLibraryButton({
  projectId,
  seriesId,
  viewId,
  disabled,
}: {
  projectId: string;
  seriesId: string;
  viewId: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"project" | "global" | null>(null);

  async function add(scope: "project" | "global") {
    setBusy(scope);
    try {
      const res = await fetch("/api/library/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          seriesId: scope === "project" ? seriesId : undefined,
          projectId,
          viewId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "添加失败");
      toast.success(
        scope === "project" ? "已加入项目资产库" : "已加入全局资产库",
      );
      setOpen(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <Button
        size="xs"
        variant="outline"
        title="保存到资产库"
        disabled={disabled || !viewId}
        onClick={() => setOpen((v) => !v)}
      >
        <BookmarkPlus className="size-3" />
        入库
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border bg-popover p-1 shadow-md">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => add("project")}
              className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {busy === "project" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Library className="size-3.5" />
              )}
              项目资产库
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => add("global")}
              className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {busy === "global" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Library className="size-3.5" />
              )}
              全局资产库
            </button>
          </div>
        </>
      )}
    </div>
  );
}
