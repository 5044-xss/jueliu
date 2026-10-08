"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import { ProjectFormDialog } from "@/components/project-form-dialog";
import type { ProjectSummary } from "@/lib/projects";

const UNGROUPED_KEY = "__ungrouped__";

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingGroup, setEditingGroup] = useState("");
  const [defaultGroup, setDefaultGroup] = useState("");

  const [groupDialog, setGroupDialog] = useState<
    { mode: "create" | "rename"; original?: string } | null
  >(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects((data.projects ?? []) as ProjectSummary[]);
    setGroups((data.groups ?? []) as string[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (cancelled) return;
        setProjects((data.projects ?? []) as ProjectSummary[]);
        setGroups((data.groups ?? []) as string[]);
      } catch {
        if (!cancelled) toast.error("读取项目列表失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openCreate(group = "") {
    setFormMode("create");
    setEditingId(undefined);
    setEditingGroup("");
    setDefaultGroup(group);
    setFormOpen(true);
  }

  function openEdit(project: ProjectSummary) {
    setFormMode("edit");
    setEditingId(project.id);
    setEditingGroup(project.group ?? "");
    setDefaultGroup("");
    setFormOpen(true);
  }

  function handleSaved(project: { id: string }) {
    setFormOpen(false);
    if (formMode === "create") {
      router.push(`/projects/${project.id}`);
    } else {
      reload();
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
      await reload();
    } catch {
      toast.error("删除失败");
    }
  }

  function openCreateGroup() {
    setGroupNameDraft("");
    setGroupDialog({ mode: "create" });
  }

  function openRenameGroup(name: string) {
    setGroupNameDraft(name);
    setGroupDialog({ mode: "rename", original: name });
  }

  async function saveGroup() {
    if (!groupDialog) return;
    const name = groupNameDraft.trim();
    if (!name) {
      toast.error("请填写分组名");
      return;
    }
    setGroupSaving(true);
    try {
      const res = await fetch("/api/project-groups", {
        method: groupDialog.mode === "rename" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          groupDialog.mode === "rename"
            ? { name: groupDialog.original, newName: name }
            : { name },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setGroups((data.groups ?? []) as string[]);
      toast.success(groupDialog.mode === "rename" ? "分组已重命名" : "分组已创建");
      setGroupDialog(null);
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGroupSaving(false);
    }
  }

  async function deleteGroup(name: string) {
    if (!window.confirm(`确定删除分组「${name}」？组内项目会移到「未分组」。`)) {
      return;
    }
    try {
      const res = await fetch("/api/project-groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "删除失败");
      setGroups((data.groups ?? []) as string[]);
      toast.success("分组已删除");
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const groupNames = projects
    ? [
        ...new Set([
          ...groups,
          ...projects.map((p) => p.group || "").filter(Boolean),
        ]),
      ].sort((a, b) => a.localeCompare(b, "zh"))
    : [];
  const sections = groupNames.map((name) => ({
    key: name,
    name,
    managed: groups.includes(name),
    items: (projects ?? []).filter((p) => (p.group || "") === name),
  }));
  const ungrouped = (projects ?? []).filter((p) => !p.group);
  if (ungrouped.length > 0) {
    sections.push({
      key: UNGROUPED_KEY,
      name: "未分组",
      managed: false,
      items: ungrouped,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Projects"
        title="项目"
        description="一次创作对应一个项目，本地存储于 workspace/。"
        actions={
          <>
            <Button variant="outline" onClick={openCreateGroup}>
              <FolderPlus className="size-4" />
              新建分组
            </Button>
            <Button onClick={() => openCreate()}>
              <Plus className="size-4" />
              新建项目
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-lilac p-4">
        <p className="text-sm">
          工作流：配置 Key → 生成提示词 → 第三方出图出片 → 回本软件合成导出。
        </p>
        <Link
          href="/help"
          className="shrink-0 text-sm font-medium underline underline-offset-2"
        >
          查看使用须知
        </Link>
      </div>

      {projects === null ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      ) : projects.length === 0 && groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            还没有项目，点击右上角「新建项目」开始。
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {sections.map((section) => {
            const isCollapsed = collapsed.has(section.key);
            return (
              <section key={section.key} className="flex flex-col gap-3">
                <div className="flex items-center gap-2 border-b pb-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.key)}
                    className="flex items-center gap-1.5 text-sm font-medium"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                    <Folder className="size-4 text-muted-foreground" />
                    {section.name}
                    <span className="text-xs font-normal text-muted-foreground">
                      {section.items.length}
                    </span>
                  </button>
                  {section.managed && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => openCreate(section.name)}
                      >
                        <Plus className="size-3" />
                        新建
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => openRenameGroup(section.name)}
                      >
                        <Pencil className="size-3" />
                        重命名
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => deleteGroup(section.name)}
                      >
                        <Trash2 className="size-3" />
                        删除
                      </Button>
                    </div>
                  )}
                </div>

                {!isCollapsed &&
                  (section.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      该分组暂无项目。
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {section.items.map((p) => (
                        <Card key={p.id}>
                          <CardHeader>
                            <CardTitle className="truncate">{p.name}</CardTitle>
                            <CardDescription>
                              创建于{" "}
                              {new Date(p.createdAt).toLocaleString("zh-CN")}
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
                              variant="outline"
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="size-4" />
                              编辑
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
                  ))}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        首次使用请先到 <Link href="/settings" className="underline">设置</Link>{" "}
        配置 LLM 与 ffmpeg。
      </p>

      {formOpen && (
        <ProjectFormDialog
          key={formMode === "edit" ? `edit-${editingId}` : "create"}
          mode={formMode}
          projectId={editingId}
          groups={groups}
          defaultGroup={defaultGroup}
          initialGroup={editingGroup}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      <Dialog
        open={groupDialog !== null}
        onOpenChange={(open) => {
          if (!open) setGroupDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {groupDialog?.mode === "rename" ? "重命名分组" : "新建分组"}
            </DialogTitle>
            <DialogDescription>
              分组只用于整理项目列表，不影响生成结果。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="group-name">分组名</Label>
            <Input
              id="group-name"
              value={groupNameDraft}
              onChange={(e) => setGroupNameDraft(e.target.value)}
              placeholder="例如：第一季 / 测试"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroupDialog(null)}
              disabled={groupSaving}
            >
              取消
            </Button>
            <Button onClick={saveGroup} disabled={groupSaving}>
              {groupSaving && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
