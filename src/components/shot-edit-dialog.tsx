"use client";

import { useState } from "react";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import type {
  DialogueLine,
  RefRole,
  StoredShot,
} from "@/lib/schemas/storyboard";
import type { StoredAsset } from "@/lib/schemas/assets";

interface RefDraft {
  role: RefRole;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}

// 首帧/起始画面不再作为镜头引用由用户手工添加（改由第三方生成弹窗设置）。
const ROLES: RefRole[] = ["character", "scene", "prop"];
const ROLE_LABEL: Record<RefRole, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function ShotEditDialog({
  projectId,
  shot,
  assets,
  nodeOptions,
  onClose,
  onSaved,
}: {
  projectId: string;
  shot: StoredShot;
  assets: StoredAsset[];
  nodeOptions: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [durationMs, setDurationMs] = useState(String(shot.durationMs));
  const [continuesPrev, setContinuesPrev] = useState(shot.continuesPrev);
  const [camera, setCamera] = useState({ ...shot.camera });
  const [lighting, setLighting] = useState(shot.lighting);
  const [action, setAction] = useState(shot.action);
  const [dialogue, setDialogue] = useState<DialogueLine[]>(shot.dialogue);
  const [expression, setExpression] = useState(shot.expression);
  const [subjectNodeIds, setSubjectNodeIds] = useState<string[]>(
    shot.subjectNodeIds,
  );
  const [refs, setRefs] = useState<RefDraft[]>(
    shot.refs.map((r) => ({
      role: r.role,
      assetName: r.assetName,
      variantLabel: r.variantLabel,
      viewLabel: r.viewLabel,
    })),
  );
  const [busy, setBusy] = useState<string | null>(null);

  function updateRef(i: number, patch: Partial<RefDraft>) {
    setRefs((list) =>
      list.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setBusy("save");
    try {
      const res = await fetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationMs: Number(durationMs) || 0,
          camera,
          lighting,
          action,
          dialogue: dialogue.filter((line) => line.text.trim().length > 0),
          expression,
          subjectNodeIds,
          continuesPrev,
          refs,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("已保存");
      onSaved();
      onClose();
    } catch {
      toast.error("保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/shots/${shot.id}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error();
      toast.success("已还原为生成时的内容");
      onSaved();
      onClose();
    } catch {
      toast.error("还原失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑镜{shot.index + 1}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>理想时长 (ms)</Label>
              <Input
                value={durationMs}
                onChange={(e) => setDurationMs(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>机位侧（轴线）</Label>
              <select
                className={selectClass}
                value={camera.side}
                onChange={(e) =>
                  setCamera((c) => ({
                    ...c,
                    side: e.target.value as typeof c.side,
                  }))
                }
              >
                <option value="">未指定</option>
                <option value="left">左</option>
                <option value="right">右</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={continuesPrev}
              onChange={(e) => setContinuesPrev(e.target.checked)}
              className="size-4 accent-primary"
            />
            延续上一镜（同一动作/空间连续推进；不勾选=硬切；本场第一镜恒为否）
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["shotSize", "景别"],
                ["focal", "焦段"],
                ["angle", "机位角度"],
                ["movement", "运镜"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label>{label}</Label>
                <Input
                  value={camera[key]}
                  onChange={(e) =>
                    setCamera((c) => ({ ...c, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>光线</Label>
            <Input value={lighting} onChange={(e) => setLighting(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>动作</Label>
            <Textarea value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>台词（每句带说话人，一镜只放同一角色）</Label>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setDialogue((list) => [...list, { character: "", text: "" }])
                }
              >
                <Plus className="size-3" />
                添加台词
              </Button>
            </div>
            {dialogue.map((line, i) => (
              <div
                key={i}
                className="grid grid-cols-[120px_1fr_auto] items-start gap-2"
              >
                <Input
                  value={line.character}
                  placeholder="说话人"
                  onChange={(e) =>
                    setDialogue((list) =>
                      list.map((l, idx) =>
                        idx === i ? { ...l, character: e.target.value } : l,
                      ),
                    )
                  }
                />
                <Textarea
                  value={line.text}
                  placeholder="台词内容"
                  onChange={(e) =>
                    setDialogue((list) =>
                      list.map((l, idx) =>
                        idx === i ? { ...l, text: e.target.value } : l,
                      ),
                    )
                  }
                />
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setDialogue((list) => list.filter((_, idx) => idx !== i))
                  }
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>表情</Label>
            <Textarea
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
            />
          </div>

          {nodeOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>画面内人物（站位节点）</Label>
              <div className="flex flex-wrap gap-1.5">
                {nodeOptions.map((node) => {
                  const active = subjectNodeIds.includes(node.id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() =>
                        setSubjectNodeIds((ids) =>
                          active
                            ? ids.filter((x) => x !== node.id)
                            : [...ids, node.id],
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? "border-foreground/30 bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {node.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Separator />
          <div className="flex items-center justify-between">
            <Label>参考图引用</Label>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setRefs((list) => [
                  ...list,
                  {
                    role: "character",
                    assetName: "",
                    variantLabel: "",
                    viewLabel: "",
                  },
                ])
              }
            >
              <Plus className="size-3" />
              添加引用
            </Button>
          </div>
          {refs.map((ref, i) => {
            const asset = assets.find((a) => a.name === ref.assetName);
            const variant = asset?.variants.find(
              (v) => v.label === ref.variantLabel,
            );
            return (
              <div
                key={i}
                className="grid grid-cols-[90px_1fr_1fr_1fr_auto] items-center gap-2"
              >
                <select
                  className={selectClass}
                  value={ref.role}
                  onChange={(e) =>
                    updateRef(i, { role: e.target.value as RefRole })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={ref.assetName}
                  onChange={(e) =>
                    updateRef(i, {
                      assetName: e.target.value,
                      variantLabel: "",
                      viewLabel: "",
                    })
                  }
                >
                  <option value="">（资产）</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={ref.variantLabel}
                  disabled={!asset}
                  onChange={(e) =>
                    updateRef(i, { variantLabel: e.target.value, viewLabel: "" })
                  }
                >
                  <option value="">（变体）</option>
                  {asset?.variants.map((v) => (
                    <option key={v.id} value={v.label}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={ref.viewLabel}
                  disabled={!variant}
                  onChange={(e) => updateRef(i, { viewLabel: e.target.value })}
                >
                  <option value="">（视角）</option>
                  {variant?.views.map((vw) => (
                    <option key={vw.id} value={vw.label}>
                      {vw.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setRefs((list) => list.filter((_, idx) => idx !== i))
                  }
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={busy !== null || !shot.hasOriginal}
            onClick={restore}
          >
            {busy === "restore" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            还原本镜
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>
              取消
            </Button>
            <Button disabled={busy !== null} onClick={save}>
              {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
