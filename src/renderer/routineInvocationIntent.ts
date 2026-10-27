import { parseRoutineInvocationTarget, type RoutineInvocationTarget } from '../shared/routineInvocation';
import { routineInvocationTargetKey } from './routineInvocationServices';

export interface RoutineInvocationEnvironment { profile: object | undefined; version: number; }
/** Sidebar目标独立于原查询；只绑定准确profile/version，不因后台原会话完成而失效。 */
export class RoutineInvocationIntent {
  readonly target: RoutineInvocationTarget;
  private readonly key: string; private readonly environment: RoutineInvocationEnvironment; private dead = false;
  private readonly listeners = new Set<() => void>();
  constructor(target: RoutineInvocationTarget, private readonly read: () => RoutineInvocationEnvironment) { this.target = Object.freeze(parseRoutineInvocationTarget(target)); this.key = routineInvocationTargetKey(this.target); const initial = read(); this.environment = { profile: initial.profile, version: initial.version }; }
  /** 目标或配置离开过一次就永久失效，恢复同名对象或同一数值也不能复活。 */
  observe(target: RoutineInvocationTarget): void { if (routineInvocationTargetKey(target) !== this.key) this.invalidate(); }
  current(): boolean {
    if (!this.dead) { try { const now = this.read(); if (!this.environment.profile || now.profile !== this.environment.profile || now.version !== this.environment.version) this.invalidate(); } catch { this.invalidate(); } }
    return !this.dead;
  }
  /** 标记同步生效，通知延后，避免父组件render期间改子组件状态。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
