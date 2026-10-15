// 轻量的按 key 串行队列：同一 key 上的任务排队执行，避免读改写交错。
// 用于编排这类「读缓存 → 重组 → 写回」的多步操作，防止并发/双击导致状态串扰。

const chains = new Map<string, Promise<void>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.finally(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
