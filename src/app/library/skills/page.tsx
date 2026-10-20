"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import type { LibrarySkill } from "@core/shared/library/skills";

interface KindInfo {
  kind: string;
  label: string;
  description: string;
  defaultPrompt: string;
  inputSchema: unknown;
  outputSchema: unknown;
}

function SchemaViewer({ kind }: { kind: KindInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <Lock className="size-3" />
        输出格式契约（内置，不可更改）
      </button>
      {open && (
        <div className="mt-2 grid gap-2">
          <p className="text-[11px] leading-5 text-muted-foreground">
            无论提示词怎么写，系统都会强制附加该 JSON Schema 作为输出契约，并在解析失败时自动重试。提示词只影响内容，不影响结构。
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-medium">输入 Schema</p>
              <pre className="max-h-52 overflow-auto rounded-md border bg-background p-2 text-[10px] leading-4">
                {JSON.stringify(kind.inputSchema, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium">输出 Schema</p>
              <pre className="max-h-52 overflow-auto rounded-md border bg-background p-2 text-[10px] leading-4">
                {JSON.stringify(kind.outputSchema, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillDialog({
  skill,
  kind,
  onOpenChange,
  onChanged,
}: {
  skill: LibrarySkill | null;
  kind: KindInfo | undefined;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? "");
  const [prompt, setPrompt] = useState(skill?.prompt ?? "");
  const [temperature, setTemperature] = useState(
    skill?.temperature?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  const dirty = skill
    ? name !== skill.name ||
      prompt !== skill.prompt ||
      temperature !== (skill.temperature?.toString() ?? "")
    : false;
  const confirm = useConfirm();

  async function save() {
    if (!skill) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prompt,
          temperature: temperature.trim() === "" ? null : Number(temperature),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success("已保存");
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!skill) return;
    if (
      !(await confirm({
        title: "删除技能",
        description: `确定删除技能「${skill.name}」？此操作不可恢复。`,
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/library/skills/${skill.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "删除失败"));
      }
      toast.success("已删除");
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || "删除失败");
    }
  }

  function restoreBuiltin() {
    if (!kind) return;
    setName("内置默认");
    setPrompt(kind.defaultPrompt);
    toast.info("已填入内置提示词，点击「保存」生效");
  }

  return (
    <Dialog open={skill !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-4 overflow-hidden sm:max-w-[min(94vw,1120px)]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{skill?.name || "技能"}</span>
            {skill?.builtin ? (
              <Badge variant="secondary">内置</Badge>
            ) : (
              <Badge variant="outline">自定义</Badge>
            )}
            {kind && <Badge variant="outline">{kind.label}</Badge>}
          </DialogTitle>
          <DialogDescription>
            提示词只描述「内容与风格要求」，不要写 JSON 结构；结构由内置契约保证。
            {skill?.builtin &&
              " 内置条目会随内置版本升级自动更新，需要长期自定义请用「新增技能」复制一份。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <label className="text-xs font-medium">名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">Temperature（留空用全局）</label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="h-8 w-28 text-sm"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="留空则生成时无系统提示词"
              className="min-h-[380px] font-mono text-xs"
            />
          </div>
          {kind && <SchemaViewer kind={kind} />}
        </div>
        </div>
        <DialogFooter className="sm:justify-between bg-background">
          <div className="flex gap-2">
            <Button variant="outline" onClick={restoreBuiltin}>
              <RotateCcw className="size-3.5" />
              恢复内置
            </Button>
            {!skill?.builtin && (
              <Button variant="destructive" onClick={remove}>
                <Trash2 className="size-3.5" />
                删除
              </Button>
            )}
          </div>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [kinds, setKinds] = useState<KindInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creatingKind, setCreatingKind] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibrarySkill | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/library/skills");
    if (!res.ok) throw new Error(await readError(res, "读取技能库失败"));
    const data = await res.json();
    return {
      skills: (data.skills ?? []) as LibrarySkill[],
      kinds: (data.kinds ?? []) as KindInfo[],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (!cancelled) {
          setSkills(data.skills);
          setKinds(data.kinds);
          setLoaded(true);
        }
      } catch (error) {
        if (!cancelled) toast.error((error as Error).message || "读取技能库失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function refresh() {
    const data = await load();
    setSkills(data.skills);
    setKinds(data.kinds);
  }

  async function create(kind: string, defaultPrompt: string) {
    setCreatingKind(kind);
    try {
      const res = await fetch("/api/library/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: "新技能",
          prompt: defaultPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      await refresh();
      setEditing(data.skill as LibrarySkill);
      toast.success("已新增技能，可在该类型下选用");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCreatingKind(null);
    }
  }

  async function setDefault(skill: LibrarySkill) {
    const res = await fetch(`/api/library/skills/${skill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) {
      toast.success("已设为当前使用");
      await refresh();
    } else {
      toast.error("设置失败");
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl bg-block-lime p-5 text-sm leading-relaxed">
        每类能力可维护多个技能条目（不同提示词），选中「使用中」的那条会在生成时采用。输出结构由内置契约强制，不受提示词影响。
      </div>
      {kinds.map((kind) => {
        const list = skills.filter((s) => s.kind === kind.kind);
        return (
          <section key={kind.kind} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">
                  {kind.label}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {kind.kind}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  {kind.description}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => create(kind.kind, kind.defaultPrompt)}
                disabled={creatingKind === kind.kind}
              >
                {creatingKind === kind.kind ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                新增技能
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((skill) => (
                <Card
                  key={skill.id}
                  size="sm"
                  className={
                    skill.isDefault ? "ring-2 ring-primary/40" : undefined
                  }
                >
                  <CardContent className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`active-${skill.kind}`}
                      checked={skill.isDefault}
                      onChange={() => setDefault(skill)}
                      aria-label="使用中"
                      className="mt-1"
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditing(skill)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {skill.name}
                        </span>
                        {skill.builtin ? (
                          <Badge variant="secondary">内置</Badge>
                        ) : (
                          <Badge variant="outline">自定义</Badge>
                        )}
                        {skill.temperature !== null && (
                          <Badge variant="outline">
                            T={skill.temperature}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {skill.prompt.trim() || "未填写提示词"}
                      </p>
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="编辑"
                      onClick={() => setEditing(skill)}
                    >
                      <Pencil />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Separator />
          </section>
        );
      })}
      <SkillDialog
        key={editing?.id ?? "closed"}
        skill={editing}
        kind={kinds.find((k) => k.kind === editing?.kind)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onChanged={refresh}
      />
    </div>
  );
}
