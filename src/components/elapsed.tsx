"use client";

import { useEffect, useState } from "react";

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${String(sec).padStart(2, "0")}秒` : `${sec}秒`;
}

// 实时显示某个任务从 startedAt 起已经跑了多久。
export function Elapsed({
  startedAt,
  className,
}: {
  startedAt?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // 没有任务时不启动计时器；setState 只在定时器回调里调用。
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  const seconds = (now - new Date(startedAt).getTime()) / 1000;
  return <span className={className}>已用时 {formatDuration(seconds)}</span>;
}
