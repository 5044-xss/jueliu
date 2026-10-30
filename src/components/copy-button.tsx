"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

export function CopyButton({
  text,
  label = "复制",
  size = "sm",
  variant = "outline",
}: {
  text: string;
  label?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "default";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.success("已复制");
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("复制失败");
    }
  }

  return (
    <Button size={size} variant={variant} onClick={copy} disabled={!text}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}
