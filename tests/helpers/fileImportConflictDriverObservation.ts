interface CommandObservation { command: object; serverErrorObserved(): boolean; recordErrno(errno: number): void; }

/** 旁听原execute Promise，this/参数/原Promise及拒绝对象原样透传；观察失败永不替代原执行结果。 */
export function observeConflictExecuteCall<Args extends unknown[], Result extends Promise<unknown>>(
  original: (...args: Args) => Result,
  capture: (args: Args) => (() => CommandObservation | undefined) | undefined,
): (this: unknown, ...args: Args) => Result {
  return function (this: unknown, ...args: Args): Result {
    let finish: (() => CommandObservation | undefined) | undefined;
    try { finish = capture(args); } catch { /* 诊断不改原执行。 */ }
    const promise = Reflect.apply(original, this, args) as Result;
    let observation: CommandObservation | undefined;
    try { observation = finish?.(); } catch { /* 不把未知Command补成最后一个Command。 */ }
    if (observation) {
      const current = observation;
      void promise.then(undefined, error => {
        try {
          if (!current.command || !current.serverErrorObserved() || !error || typeof error !== 'object') return;
          const errno = Object.getOwnPropertyDescriptor(error, 'errno');
          if (errno && 'value' in errno && Number.isSafeInteger(errno.value) && errno.value > 0) current.recordErrno(errno.value);
        } catch { /* 只读旁听不抛错、不复制SQL或错误正文。 */ }
      });
    }
    return promise;
  };
}
