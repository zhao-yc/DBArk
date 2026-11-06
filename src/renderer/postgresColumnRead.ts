import { useEffect, useRef, useState } from 'react';
import type { PostgresTableColumn, PostgresTableColumnReadInput } from '../shared/postgresTable';
import { errorMessage } from './lib';
import { acquireWorkspaceBusy, type WorkspaceBusyLease } from './store';

export interface PostgresColumnReadSource {
  input: Omit<PostgresTableColumnReadInput, 'column'>;
  columns: readonly PostgresTableColumn[];
  initialColumn?: string;
  current(): boolean;
}

/** 关闭后丢弃回包，工作区占用仍由原只读任务完成时释放。 */
export function usePostgresColumnRead<T>(source: PostgresColumnReadSource, expired: string) {
  const origin = useRef(source).current;
  const [result, setResult] = useState<T>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(false), reading = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  function reset() { setResult(undefined); setError(''); }

  async function read(action: () => Promise<T>) {
    if (reading.current) return;
    if (!origin.current()) { setError(expired); return; }
    reset();
    reading.current = true;
    setBusy(true);
    let lease: WorkspaceBusyLease | undefined;
    try {
      lease = acquireWorkspaceBusy(origin.input.tabId);
      const next = await action();
      if (!live.current) return;
      if (!origin.current()) throw Error(expired);
      setResult(next);
    } catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally {
      reading.current = false;
      lease?.release();
      if (live.current) setBusy(false);
    }
  }
  return { origin, result, busy, error, setError, reading, read, reset };
}
