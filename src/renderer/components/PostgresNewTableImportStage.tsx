import { useEffect, useState } from 'react';
import type { ImportNewTableSeed } from '../../shared/importNewTable';
import type { PostgresTableImportChoice, PostgresTablePage, PostgresTableTarget } from '../../shared/postgresTable';
import { errorMessage, invoke, uid } from '../lib';
import { importNewTableZh as text } from '../locales/importNewTable.zh-CN';
import { postgresTableImportZh as importText } from '../locales/postgresTableImport.zh-CN';
import { useWorkspace } from '../store';
import { PostgresTableImportDialog } from './PostgresTableImportDialog';
import { ErrorBox, Modal, Spinner } from './ui';

/** 向导独占临时表页能力，退出时释放；不触碰用户打开的表页、编辑草稿或筛选。 */
export function PostgresNewTableImportStage({ connectionId, database, table, seed, isCurrent, onClose }: {
  connectionId: string; database: string; table: string; seed: ImportNewTableSeed; isCurrent(): boolean; onClose(): void;
}) {
  const [target] = useState<PostgresTableTarget>(() => ({ connectionId, database, table, tabId: uid() }));
  const [ready, setReady] = useState<{ page: PostgresTablePage; file: PostgresTableImportChoice }>();
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true, pageToken: string | undefined;
    function release() {
      if (!pageToken) return;
      const token = pageToken;
      pageToken = undefined;
      void invoke('postgres.table.release', { ...target, pageToken: token }).catch(() => {});
    }
    queueMicrotask(async () => {
      if (!live) return;
      try {
        if (!isCurrent()) throw Error(text.stale);
        const page = await invoke('postgres.table.page', { ...target, offset: 0, limit: 1 });
        pageToken = page.exportToken ?? page.pageToken;
        if (!live) { release(); return; }
        if (!isCurrent()) throw Error(text.stale);
        if (!page.exportToken || !page.canImport) throw Error(text.postgresTargetUnavailable);
        const scannedFile = { token: seed.file.token, expectedSource: seed.expectedSource };
        const options = seed.format === 'xml' ? { format: seed.format, xmlOptions: seed.xmlOptions!, scannedFile } :
          seed.format === 'txt' ? { format: seed.format, encoding: seed.encoding, txtOptions: seed.txtOptions!, scannedFile } :
          seed.format === 'csv' ? { format: seed.format, encoding: seed.encoding, csvDelimiter: seed.csvDelimiter ?? ',',
            csvHasHeader: seed.csvHasHeader ?? true, scannedFile } : { format: seed.format, encoding: seed.encoding, scannedFile };
        const file = await invoke('postgres.table.importChoose', { ...target, pageToken: page.exportToken, ...options });
        if (!live) return;
        if (!file || !isCurrent()) throw Error(text.stale);
        setReady({ page, file });
      } catch (reason) {
        release();
        if (live) setError(errorMessage(reason));
      }
    });
    return () => { live = false; release(); };
  }, [target, seed, isCurrent]);

  if (ready) return <PostgresTableImportDialog target={target} page={ready.page} isCurrent={isCurrent}
    initialSource={{ file: ready.file, mapping: seed.mapping, format: seed.format, xmlOptions: seed.xmlOptions }} onClose={onClose} onOutcome={(message, committed) => {
      useWorkspace.getState().notify(message, !committed);
      onClose();
    }}/>;
  return <Modal title={importText.title} onClose={() => { if (error) onClose(); }}>
    <div className="modal-content">{error ? <ErrorBox message={error}/> : <Spinner text={text.postgresSourceCheck}/>}</div>
    <footer className="modal-footer"><button disabled={!error} onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
