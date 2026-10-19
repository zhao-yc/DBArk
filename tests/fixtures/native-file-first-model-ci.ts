import { createHash } from 'node:crypto';
import { fileFirstModelCases, type FileFirstModelCase } from '../helpers/queryFileFirstModelNative';

/** 仅合成报告夹具，按真实四例golden构造完整footer；不作为任何真实原生批准或退出证据。 */
export function firstModelProof(value: FileFirstModelCase = fileFirstModelCases[0]) {
  const identity = { dev: '1', ino: '2', size: Buffer.byteLength(value.source), hash: createHash('sha256').update(value.source).digest('hex') };
  const stages = ['普通字符编辑', '普通字符一次Undo且clean', '首次格式化', '格式化一次Undo且clean', '格式化Redo', '最终Undo且clean', '独立重启且clean'];
  const events: object[] = [];
  const witnesses: object[] = [{ stage: '首次模型且尚无用户编辑', initial: { caseKey: value.key, bytes: identity.size, eol: value.eol, version: 23, alternative: 17, userEditsBeforeInitial: 0 }, identity }];
  for (const [index, stage] of stages.entries()) {
    const formatted = index === 2 || index === 4, restarted = index === 6, undo = [1, 3, 5].includes(index);
    if (!restarted) events.push({ version: 24 + index, eol: value.eol, undo, redo: index === 4, eolChange: false, flush: false });
    const position = index === 0 ? 1 : formatted ? value.formatted.length : 0;
    witnesses.push({ stage, model: { editorId: 1, modelId: 2, value: index === 0 ? 'x' + value.source : formatted ? value.formatted : value.source, eol: value.eol, version: restarted ? 1 : 24 + index, alternative: restarted ? 1 : formatted ? 19 : undo ? 17 : 18, focused: true, overflow: 0, events: restarted ? [] : [...events], options: { tabSize: 2, indentSize: 2, insertSpaces: true, readOnly: false }, selections: [{ start: position, end: position, anchor: position, position }] } });
  }
  return { caseKey: value.key, entry: value.entry, sourceEol: value.eol, identity, witnesses, files: [{ stage: 'paths-planned', paths: { source: '/RAM/native-source.sql', missing: '/RAM/native-missing.sql', replacement: '/RAM/native-replacement.sql' } }, { stage: 'directory-captured', dev: '1', ino: '1' }, { stage: 'write-planned', path: '/RAM/native-source.sql', size: identity.size, hash: identity.hash }, { stage: 'original-handle-captured', path: '/RAM/native-source.sql', identity }, { stage: 'created', path: '/RAM/native-source.sql', identity }], accepted: true, ordinarySingleUndo: true, formatSingleUndo: true, sqliteSchema: 9, directoryRemoved: true, normalOwners: [0, 1].map(() => ({ confirmed: true, willQuit: true, closed: true, recordedPids: 3 })), sqlExecution: 0, queryLibraryWrites: 0, systemClipboard: 0, dirtyAnswerInstalled: false };
}

/** 模拟Playwright实际live报告路径；执行端口由单元测试提供，禁止启动任何原生程序。 */
export function firstModelReport() {
  return { errors: [], stats: { expected: 4, skipped: 0, unexpected: 0, flaky: 0 }, suites: [{ specs: fileFirstModelCases.map(value => ({ title: value.title, file: 'query-file-first-model-native-live.ts', ok: true, tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [], attachments: [{ name: '文件首次模型原生终态', contentType: 'application/json', body: Buffer.from(JSON.stringify(firstModelProof(value))).toString('base64') }] }] }] })) }] };
}
