export interface SpecialIndexCleanupActions {
  databaseAttempted: boolean;
  closeAll(): Promise<unknown>;
  closeTracked(): Promise<unknown>;
  verifyThreadsGone(): Promise<unknown>;
  dropOwnDatabase(): Promise<unknown>;
  verifyDatabaseGone(): Promise<unknown>;
  restoreObservation(): unknown;
  closeObserverStrict(): Promise<unknown>;
}

/** 只在真实线程清零后精确删本例库；所有收尾独立尝试，finally不能覆盖最早失败。 */
export async function cleanupSpecialIndexFixture(actions: SpecialIndexCleanupActions): Promise<void> {
  const failures: unknown[] = [];
  async function attempt(action: () => unknown | Promise<unknown>): Promise<boolean> {
    try { await action(); return true; } catch (error) { failures.push(error); return false; }
  }
  try {
    await attempt(() => actions.closeAll());
    await attempt(() => actions.closeTracked());
    const released = await attempt(() => actions.verifyThreadsGone());
    if (released && actions.databaseAttempted) {
      await attempt(() => actions.dropOwnDatabase());
      await attempt(() => actions.verifyDatabaseGone());
    }
  } finally {
    await attempt(() => actions.restoreObservation());
    await attempt(() => actions.closeObserverStrict());
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, '特殊索引验收收尾存在多项失败，首个错误已保留', { cause: failures[0] });
}
