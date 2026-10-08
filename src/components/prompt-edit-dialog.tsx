"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface EditField {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
}

export function PromptEditDialog({
  title,
  hint,
  fields,
  onClose,
  onSave,
  onDelete,
  onRestore,
}: {
  title: string;
  hint?: string;
  fields: EditField[];
  onClose: () => void;
  onSave: (values: Record<string, string>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onRestore?: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
              {field.multiline ? (
                <Textarea
                  id={`field-${field.key}`}
                  value={values[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  className="min-h-[140px]"
                />
              ) : (
                <Input
                  id={`field-${field.key}`}
                  value={values[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {onRestore && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => run("restore", onRestore)}
              >
                {busy === "restore" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                还原默认
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm("确定删除？该操作不可恢复。")) {
                    run("delete", onDelete);
                  }
                }}
              >
                {busy === "delete" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>
              取消
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => run("save", () => onSave(values))}
            >
              {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
