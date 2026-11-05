import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTableOutcome, PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import type { PostgresStructureInput, PostgresStructureResult } from '../../shared/postgresStructure';
import { postgresRelationName } from '../../shared/postgresSql';
import { postgresColumnEditZh as text } from '../locales/postgresColumnEdit.zh-CN';
import { errorMessage } from '../lib';
import { useWorkspace } from '../store';

export interface PostgresStructureEditProps {
  target: PostgresStructureInput;
  original: PostgresStructureResult;
  version: number;
  onClose(): void;
  onResult(message: string, unknown: boolean, receipt?: PostgresCreateTableOutcome): void;
  onDirtyChange(value: boolean): void;
}

/** 字段和索引共用原目标保护、单次提交、未知终态和窗口草稿状态。 */
export function usePostgresStructureEdit({ target, original, version, onResult, onDirtyChange }: PostgresStructureEditProps,
  dirty: boolean, dropping: boolean, readPreview: () => Promise<PostgresCreateTablePreview>,
  applyPreview: (token: string) => Promise<PostgresCreateTableOutcome>) {
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [acceptDrop, setAcceptDrop] = useState(false);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const operation = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(busy || dirty); }, [busy, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 只允许已读连接修订及无表页草稿的目标进入修改流程。 */
  function assertCurrent() {
    const workspace = useWorkspace.getState();
    if (!alive.current || (workspace.connectionVersions[target.connectionId] ?? 0) !== version) throw Error(text.changed);
    if (workspace.settings.tabs.some(tab => {
      if (tab.kind !== 'table' || tab.connectionId !== target.connectionId || (tab.database || 'postgres') !== target.database ||
          !tab.table || !(workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id])) return false;
      const relation = postgresRelationName(tab.table);
      return relation.schema === original.schema && relation.name === original.name;
    })) throw Error(text.dirty);
  }

  /** 同步占用预览和提交入口，回执不依赖窗口渲染时序。 */
  async function submit(apply: boolean) {
    if (operation.current || unknown || apply && (!preview || dropping && !acceptDrop)) return;
    operation.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      assertCurrent();
      setPreview(undefined);
      if (!apply) {
        setAcceptDrop(false);
        const result = await readPreview();
        assertCurrent();
        setPreview(result);
        return;
      }
      sent = true;
      const result = await applyPreview(preview!.token);
      if (result.outcome === 'committed') onResult(result.message, false, result);
      else if (result.outcome === 'unknown') {
        setUnknown(true);
        onResult(result.message, true);
      } else setError(result.message);
    } catch (reason) {
      if (alive.current) {
        const message = errorMessage(reason);
        setError(message);
        if (sent) {
          setUnknown(true);
          onResult(message, true);
        }
      }
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return { preview, setPreview, acceptDrop, setAcceptDrop, busy, unknown, error, setError, operation, submit };
}
