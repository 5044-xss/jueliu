"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type LlmState = "loading" | "configured" | "missing";

// 生成剧本/资产/分镜都依赖 LLM。这里提前探测是否已配置 Key，
// 避免用户点了生成才拿到「未配置」之类的底层报错。
export function useLlmConfigured(): LlmState {
  const [state, setState] = useState<LlmState>("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        // 接口返回的是打码后的 Key，非空即代表已配置。
        const key = data?.settings?.llm?.apiKey;
        setState(
          typeof key === "string" && key.length > 0 ? "configured" : "missing",
        );
      })
      .catch(() => {
        // 读取失败时不拦截，交给生成时的真实报错处理。
        if (!cancelled) setState("configured");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function LlmKeyNotice() {
  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardContent className="flex flex-wrap items-center gap-2 py-4 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4 shrink-0" />
        <span>尚未配置 LLM API Key，无法生成剧本 / 资产 / 分镜。</span>
        <Link
          href="/settings#llm"
          className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          <KeyRound className="size-3.5" />
          去设置填写
        </Link>
      </CardContent>
    </Card>
  );
}
