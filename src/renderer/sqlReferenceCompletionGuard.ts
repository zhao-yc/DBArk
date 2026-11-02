/** 引用解析期间及原编辑器的peek打开时，不交付迟到的补全候选；不改持久偏好或正文。 */
export class SqlReferenceCompletionGuard {
  private pending = new Set<AbortSignal>();
  /** 代次以原信号为身份；取消立即释放，旧请求finally不能解除继任请求的保护。 */
  acquire(signal: AbortSignal): () => void {
    if (signal.aborted) return () => {};
    this.pending.add(signal);
    const release = () => { this.pending.delete(signal); signal.removeEventListener('abort', release); };
    signal.addEventListener('abort', release, { once: true });
    return release;
  }
  /** 只看原编辑器内部的Monaco引用面板，其他标签或编辑器不会相互屏蔽。 */
  blocked(root: Pick<Element, 'querySelector'> | null): boolean { return this.pending.size > 0 || !!root?.querySelector('.reference-zone-widget'); }
}
