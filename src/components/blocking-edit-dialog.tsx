"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { SelectField } from "@/components/ui/select";
import { readError } from "@/lib/http";
import type { Blocking } from "@core/shared/schemas/storyboard";

const NODE_TYPES = ["character", "prop", "screen", "landmark"] as const;

export function BlockingEditDialog({
  projectId,
  sceneId,
  sceneLabel,
  blocking,
  onClose,
  onSaved,
}: {
  projectId: string;
  sceneId: string;
  sceneLabel: string;
  blocking: Blocking | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Blocking>(
    blocking ?? {
      axis: { from: "", to: "" },
      cameraSide: "left",
      nodes: [],
      paths: [],
    },
  );
  const [busy, setBusy] = useState(false);

  function updateNode(
    i: number,
    patch: Partial<Blocking["nodes"][number]>,
  ) {
    setValue((v) => ({
      ...v,
      nodes: v.nodes.map((n, idx) => (idx === i ? { ...n, ...patch } : n)),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocking: value }),
      });
      if (!res.ok) throw new Error(await readError(res, "保存失败"));
      toast.success("站位已保存");
      onSaved();
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑站位 · {sceneLabel}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>轴线起点节点 id</Label>
              <Input
                value={value.axis.from}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    axis: { ...v.axis, from: e.target.value },
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>轴线终点节点 id</Label>
              <Input
                value={value.axis.to}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    axis: { ...v.axis, to: e.target.value },
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>镜头锁定侧</Label>
              <SelectField
                value={value.cameraSide}
                onChange={(cameraSide) =>
                  setValue((v) => ({
                    ...v,
                    cameraSide: cameraSide as Blocking["cameraSide"],
                  }))
                }
                options={[
                  { value: "left", label: "左" },
                  { value: "right", label: "右" },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>站位节点（人物/道具/屏幕/地标）</Label>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setValue((v) => {
                  // 生成未占用的 id：删除节点后 length+1 可能撞上已有 id。
                  const used = new Set(v.nodes.map((node) => node.id));
                  let n = v.nodes.length + 1;
                  while (used.has(`n${n}`)) n += 1;
                  return {
                    ...v,
                    nodes: [
                      ...v.nodes,
                      {
                        id: `n${n}`,
                        label: "",
                        type: "character",
                        pos: { x: 0.5, y: 0.5 },
                        facing: 0,
                      },
                    ],
                  };
                })
              }
            >
              <Plus className="size-3" />
              添加节点
            </Button>
          </div>

          {value.nodes.map((node, i) => (
            <div
              key={i}
              className="grid grid-cols-[70px_1fr_90px_70px_70px_70px_auto] items-center gap-2"
            >
              <Input
                value={node.id}
                onChange={(e) => updateNode(i, { id: e.target.value })}
                placeholder="id"
              />
              <Input
                value={node.label}
                onChange={(e) => updateNode(i, { label: e.target.value })}
                placeholder="名称"
              />
              <SelectField
                value={node.type}
                onChange={(type) =>
                  updateNode(i, {
                    type: type as Blocking["nodes"][number]["type"],
                  })
                }
                options={NODE_TYPES.map((t) => ({ value: t, label: t }))}
              />
              <Input
                value={String(node.pos.x)}
                onChange={(e) =>
                  updateNode(i, {
                    pos: { ...node.pos, x: Number(e.target.value) || 0 },
                  })
                }
                placeholder="x"
              />
              <Input
                value={String(node.pos.y)}
                onChange={(e) =>
                  updateNode(i, {
                    pos: { ...node.pos, y: Number(e.target.value) || 0 },
                  })
                }
                placeholder="y"
              />
              <Input
                value={String(node.facing)}
                onChange={(e) =>
                  updateNode(i, { facing: Number(e.target.value) || 0 })
                }
                placeholder="朝向"
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setValue((v) => ({
                    ...v,
                    nodes: v.nodes.filter((_, idx) => idx !== i),
                  }))
                }
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            pos 为俯视相对坐标 0~1；facing 为朝向角度 0~360（0 为画面右方）。轴线用两个主要人物节点的 id。
          </p>
        </div>
        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
