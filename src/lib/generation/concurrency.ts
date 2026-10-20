// 出图并发控制：Toapi 账号对同时在跑的任务数有限制（实测 gpt-image-2-vip 约 3 个，
// 超过会返回 RateLimitReached / service_busy），因此批量出图不能无脑并发，
// 必须经过一个进程级闸门把「建任务 → 轮询 → 下载」压在阈值内。

/** 计数信号量；运行时可调整上限（设置里的并发数变化时）。 */
export class Semaphore {
  private limit: number;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit) || 1);
  }

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.floor(limit) || 1);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      this.active += 1;
      this.queue.shift()?.();
    }
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    if (this.active > 0) this.active -= 1;
    this.pump();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** 以固定并发度依次处理 items；fn 内部自行吞掉异常，不会中断整批。 */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
