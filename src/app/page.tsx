"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectSummary } from "@/lib/projects";
import type { LibraryStyle } from "@/lib/library/types";

const ASPECT_OPTIONS = ["9:16", "16:9", "1:1"];

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [styleId, setStyleId] = useState("");
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [defaultSegmentMs, setDefaultSegmentMs] = useState(10000);

  const load = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    return (data.projects ?? []) as ProjectSummary[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await load();
        if (!cancelled) setProjects(list);
      } catch {
        if (!cancelled) toast.error("读取项目列表失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

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

  async function create() {
    if (!name.trim()) {
      toast.error("请填写项目名");
      return;
    }
    setCreating(true);
    try {
      const chosen = styles.find((s) => s.id === styleId);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          style: chosen ? chosen.prompt : style,
          styleId: chosen ? chosen.id : null,
          aspectRatio,
          defaultSegmentMs,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success("项目已创建");
      setOpen(false);
      setName("");
      setStyle("");
      setStyleId("");
      router.push(`/projects/${data.project.id}`);
    } catch {
      toast.error("创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string, projectName: string) {
    if (
      !window.confirm(
        `确定删除项目「${projectName}」？其本地数据与媒体文件将一并删除，且不可恢复。`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("已删除");
      setProjects(await load());
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">项目</h1>
          <p className="text-sm text-muted-foreground">
            一次创作对应一个项目，本地存储于 workspace/。
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="size-4" />
            新建项目
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>
                设定项目风格与画面比例，后续所有生成都会继承。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="p-name">项目名</Label>
                <Input
                  id="p-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：城市广场的告白"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-style">风格</Label>
                <select
                  id="p-style"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="">自定义</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {!styleId && (
                  <Input
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    placeholder="自定义风格提示词"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  风格库在「资源库 → 风格库」中管理。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="p-ratio">画面比例</Label>
                  <select
                    id="p-ratio"
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {ASPECT_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-ms">默认段时长 (ms)</Label>
                  <Input
                    id="p-ms"
                    type="number"
                    min={1000}
                    step={500}
                    value={defaultSegmentMs}
                    onChange={(e) =>
                      setDefaultSegmentMs(Number(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={create} disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {projects === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            还没有项目，点击右上角「新建项目」开始。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">{p.name}</span>
                </CardTitle>
                <CardDescription>
                  创建于 {new Date(p.createdAt).toLocaleString("zh-CN")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => router.push(`/projects/${p.id}`)}
                >
                  <FolderOpen className="size-4" />
                  打开
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => remove(p.id, p.name)}
                >
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        首次使用请先到 <Link href="/settings" className="underline">设置</Link>{" "}
        配置 LLM 与 ffmpeg。
      </p>
    </div>
  );
}
