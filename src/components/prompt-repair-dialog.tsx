"use client";

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { readError } from "@/lib/http";

export function PromptRepairDialog({
  open,
  onOpenChange,
  projectId,
  segmentId,
  platform,
  keyframeOnly,
  currentPrompt,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  segmentId: string;
  platform: string;
  keyframeOnly: boolean;
  currentPrompt: string;
  onApply: (prompt: string) => Promise<boolean>;
}) {
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setIssue("");
    setBusy(false);
    setApplying(false);
    setResult("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function generate() {
    if (!issue.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult("");
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: "storyboard-prompt-repair",
          projectId,
          input: {
            segmentId,
            platform,
            keyframeOnly,
            currentPrompt,
            issue: issue.trim(),
          },
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "修改提示词失败"));
      const data = await res.json().catch(() => ({}));
      const text = typeof data?.result === "string" ? data.result.trim() : "";
      if (!text) throw new Error("修改结果为空，请换一种描述方式重试");
      setResult(text);
    } catch (err) {
      setError((err as Error).message || "修改提示词失败");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result.trim() || applying) return;
    setApplying(true);
    setError(null);
    try {
      const ok = await onApply(result);
      if (ok) handleOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "应用修改失败");
    } finally {
      setApplying(false);
    }
  }

  const locked = busy || applying;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!locked) handleOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>按意见修改提示词</DialogTitle>
          <DialogDescription>
            描述哪里不对或希望怎么改，AI 只修改当前提示词，不会自动生成视频。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {result ? (
            <>
              <span className="text-xs font-medium">修改结果</span>
              <textarea
                value={result}
                readOnly
                spellCheck={false}
                className="min-h-64 w-full resize-none rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-6 outline-none"
              />
            </>
          ) : (
            <>
              <label
                htmlFor="prompt-repair-issue"
                className="text-xs font-medium"
              >
                问题描述
              </label>
              <textarea
                id="prompt-repair-issue"
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    void generate();
                  }
                }}
                autoFocus
                spellCheck={false}
                placeholder="例如：人物动作写得太笼统，镜头移动不清楚；台词漏了；参考图编号引用错了……"
                className="min-h-28 w-full resize-none rounded-lg border bg-transparent p-3 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </>
          )}

          {error && (
            <p className="text-xs leading-5 text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={locked}
          >
            取消
          </Button>
          {result ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setResult("");
                  setError(null);
                }}
                disabled={locked}
              >
                重新描述
              </Button>
              <Button onClick={() => void apply()} disabled={locked}>
                {applying ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                应用修改
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void generate()}
              disabled={locked || !issue.trim()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              生成修改
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
