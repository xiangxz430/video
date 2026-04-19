/**
 * 通用轮询工具
 * 用于等待异步任务完成
 */

export interface PollOptions {
  /** 轮询间隔（毫秒） */
  intervalMs: number;
  /** 最大等待时间（毫秒） */
  maxWaitMs: number;
  /** 任务名称（用于日志） */
  taskName?: string;
}

/**
 * 通用轮询函数
 * @param pollFn 轮询函数，返回 { done: boolean, result?: T, status?: string }
 * @param options 轮询选项
 * @returns 任务结果
 */
export async function pollUntilComplete<T>(
  pollFn: () => Promise<{ done: boolean; result?: T; status?: string }>,
  options: PollOptions
): Promise<T> {
  const { intervalMs, maxWaitMs, taskName = '任务' } = options;
  const startTime = Date.now();
  let attempt = 0;

  while (true) {
    // 检查超时
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new Error(`${taskName}超时（已等待 ${Math.floor(elapsed / 1000)}秒）`);
    }

    // 等待
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    attempt++;

    // 轮询
    const { done, result, status } = await pollFn();

    if (done && result) {
      console.log(`[${taskName}] 完成，耗时 ${Math.floor((Date.now() - startTime) / 1000)}秒，共轮询 ${attempt} 次`);
      return result;
    }

    // 可选：每10次打印一次状态
    if (attempt % 10 === 0 && status) {
      console.log(`[${taskName}] 状态: ${status}，已等待 ${Math.floor(elapsed / 1000)}秒`);
    }
  }
}

/**
 * 便捷函数：固定间隔轮询
 */
export async function pollWithFixedInterval<T>(
  pollFn: () => Promise<{ done: boolean; result?: T; status?: string }>,
  options: {
    intervalMs?: number;
    maxRetries?: number;
    taskName?: string;
  } = {}
): Promise<T> {
  const intervalMs = options.intervalMs || 5000;
  const maxRetries = options.maxRetries || 120;
  
  return pollUntilComplete(pollFn, {
    intervalMs,
    maxWaitMs: intervalMs * maxRetries,
    taskName: options.taskName
  });
}
