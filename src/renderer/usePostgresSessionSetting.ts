import { useEffect, useRef, useState } from 'react';
import type { QueryTransactionSettingsIntent } from './queryTransactionSettingsIntent';
import { errorMessage } from './lib';

/** 同一窗口仅允许对最后一次已确认的会话快照应用修改，迟到回复不能更新其它窗口。 */
export function usePostgresSessionSetting<Snapshot, Change>({intent, onRead, onApply, onClose, parse, onSnapshot, text}: {
  intent: QueryTransactionSettingsIntent;
  onRead(): Promise<Snapshot>;
  onApply(expected: Snapshot, change: Change): Promise<Snapshot>;
  onClose(): void;
  parse(value: unknown): Snapshot;
  onSnapshot(value: Snapshot): void;
  text: {loading: string; applying: string; ready: string; applied: string; changed: string};
}) {
  const mounted = useRef(false), running = useRef(false), generation = useRef(0);
  const fresh = useRef<Snapshot | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [pending, setPending] = useState(false), [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');

  async function request(change?: Change) {
    if (!mounted.current || running.current || !intent.current()) return;
    const before = fresh.current;
    if (change !== undefined && (before === undefined || before !== snapshot)) return;
    const epoch = ++generation.current;
    running.current = true;
    fresh.current = undefined;
    setPending(true);
    setError('');
    setStatus(change === undefined ? text.loading : text.applying);
    try {
      const next = parse(await (change === undefined ? onRead() : onApply(before!, change)));
      if (!mounted.current || generation.current !== epoch) return;
      intent.assertCurrent();
      fresh.current = next;
      setSnapshot(next);
      onSnapshot(next);
      setStatus(change === undefined ? text.ready : text.applied);
    } catch (reason) {
      if (mounted.current && generation.current === epoch) {
        setError(errorMessage(reason));
        setStatus('');
      }
    } finally {
      if (mounted.current && generation.current === epoch) {
        running.current = false;
        setPending(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    running.current = false;
    const unsubscribe = intent.subscribe(() => { fresh.current = undefined; setInvalid(true); });
    void request();
    return () => { mounted.current = false; generation.current++; unsubscribe(); };
  }, [intent]);

  function close() { if (!running.current) onClose(); }
  return {snapshot, pending, invalid, status, error: invalid ? text.changed : error,
    editable: !pending && !invalid && fresh.current !== undefined, request, close};
}
