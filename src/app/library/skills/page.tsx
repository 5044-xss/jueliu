"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { LibrarySkill } from "@/lib/library/skills";

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
            无论上面的提示词怎么写，系统都会强制附加该 JSON Schema 作为输出契约，
            并在解析失败时自动重试。提示词只影响内容，不影响结构。
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
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">查看内置默认提示词</summary>
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 leading-4">
              {kind.defaultPrompt}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function SkillEntry({
  skill,
  defaultPrompt,
  onChanged,
  onDeleted,
}: {
  skill: LibrarySkill;
  defaultPrompt: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(skill.name);
  const [prompt, setPrompt] = useState(skill.prompt);
  const [temperature, setTemperature] = useState(
    skill.temperature?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);
  const effectivePrompt = prompt.trim() ? prompt : defaultPrompt;
  const dirty =
    name !== skill.name ||
    prompt !== skill.prompt ||
    temperature !== (skill.temperature?.toString() ?? "");

  async function save() {
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
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setDefault() {
    await fetch(`/api/library/skills/${skill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    toast.success("已设为当前使用");
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`确定删除技能「${skill.name}」？`)) return;
    const res = await fetch(`/api/library/skills/${skill.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("已删除");
      onDeleted();
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <Card className={skill.isDefault ? "ring-2 ring-primary/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`active-${skill.kind}`}
              checked={skill.isDefault}
              onChange={setDefault}
            />
            <span className="text-sm">使用中</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 max-w-[220px] text-sm"
          />
          {!prompt.trim() && <Badge variant="outline">内置提示词</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={effectivePrompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[220px] font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          提示词只描述“内容与风格要求”，不要写 JSON 结构；结构由内置契约保证。
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">
              Temperature（留空用全局）
            </label>
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
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            保存
          </Button>
          <Button size="sm" variant="destructive" onClick={remove}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [kinds, setKinds] = useState<KindInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creatingKind, setCreatingKind] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/library/skills");
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
      } catch {
        if (!cancelled) toast.error("读取技能库失败");
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
      toast.success("已新增技能，可在该类型下选用");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCreatingKind(null);
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
      <p className="text-sm text-muted-foreground">
        每类能力可维护多个技能条目（不同提示词），勾选「使用中」的那条会被生成时采用。
        输出结构由内置契约强制，不受提示词影响。
      </p>
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
            <SchemaViewer kind={kind} />
            <div className="grid gap-3">
              {list.map((skill) => (
                <SkillEntry
                  key={skill.id}
                  skill={skill}
                  defaultPrompt={kind.defaultPrompt}
                  onChanged={refresh}
                  onDeleted={refresh}
                />
              ))}
            </div>
            <Separator />
          </section>
        );
      })}
    </div>
  );
}
