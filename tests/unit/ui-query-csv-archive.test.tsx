import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QueryStreamExportDialog } from '../../src/renderer/components/QueryStreamExportDialog';
import { queryExportFileFormat } from '../../src/shared/queryStreamExport';
import { streamExecutionAllowed, streamResultSelection } from '../../src/renderer/queryStreamExport';
import { queryStreamZh } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { csvExportOptions } from '../../src/shared/csvExport';

// 参数窗口此项不打开；隔离其Monaco模块加载，仍渲染真实导出窗口与按钮。
vi.mock('../../src/renderer/components/QueryParametersDialog', () => ({ QueryParametersDialog: () => null }));

/** 执行真实组件处理函数，替代React状态与IPC端口；不将此非GUI验证冒充Monaco验收。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/components/QueryStreamExportDialog.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), functions: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && ['chooseFile', 'execute', 'invalidate'].includes(node.name?.text ?? '')) functions.push(node.getText(tree)); else node.forEachChild(visit); }; tree.forEachChild(visit);
  const invoke = vi.fn(async () => ({ token: 'zip-target', name: 'all.zip' })), onExecute = vi.fn(async () => ({ fileCommitted: true, results: [] }));
  const context = createContext({ csvExportOptions, csvDelimiter: ',', queryExportFileFormat, streamExecutionAllowed, streamResultSelection, text: queryStreamZh, Error, format: 'csv-zip', encoding: 'utf8', protocol: 'text-strict', ordinal: 'unused', file: { token: 'zip-target' }, acknowledged: false, binaryAcknowledged: false, sessionBusy: false, completed: false, parameters: undefined, task: { current: '' }, busyRef: { current: false }, choosingRef: { current: false }, uid: () => 'single-task', invoke, onExecute, errorMessage: (error: unknown) => String(error) });
  // 正式表单增加归属与配置代次；本夹具模拟每次状态更新后的当前渲染，保留全部原断言。
  context.live={current:true};context.configuration={current:0};context.completedRef={current:false};context.publishingRef={current:false};
  Object.defineProperty(context,'generation',{get:()=>context.configuration.current});
  for (const name of ['Choosing', 'Error', 'Acknowledged', 'BinaryAcknowledged', 'Busy', 'Progress', 'Cancelling', 'Output', 'Completed', 'Failed', 'File','Publishing','Pending','Confirmation','PublishAck']) context['set' + name] = vi.fn((value: unknown) => { if (name === 'Acknowledged') context.acknowledged = value; if (name === 'BinaryAcknowledged') context.binaryAcknowledged = value; if (name === 'Completed') context.completed = value; });
  runInContext(ts.transpileModule(functions.join('\n') + '\nglobalThis.handlers={chooseFile,execute}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, invoke, onExecute, handlers: context.handlers as { chooseFile(): Promise<void>; execute(): Promise<void> } };
}

describe('多CSV容器的实际导出入口', () => {
  it('真实组件公开CSV ZIP选项，保留明确新执行与已有单CSV入口', () => {
    const html = renderToStaticMarkup(<QueryStreamExportDialog source="SELECT 1;SELECT 2" sessionBusy={false} loadNames={vi.fn()} onExecute={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}/>);
    expect(html).toContain('value="csv-zip"'); expect(html).toContain(queryStreamZh.csvZip); expect(html).toContain(queryStreamZh.acknowledge); expect(html).toContain(queryStreamZh.csv); expect(html).toContain('disabled=""');
  });
  it('先选择ZIP文件只授权不执行，设置变化撤销确认，明确确认后才单次投递全部结果', async () => {
    const f = fixture(); await f.handlers.execute(); expect(f.onExecute).not.toHaveBeenCalled(); f.context.acknowledged = true;
    await f.handlers.chooseFile(); expect(f.invoke).toHaveBeenCalledExactlyOnceWith('files.choose', { purpose: 'export', format: 'zip', suggestedName: queryStreamZh.defaultName + '.zip' }); expect(f.context.acknowledged).toBe(false); expect(f.onExecute).not.toHaveBeenCalled();
    f.context.acknowledged = true; await Promise.all([f.handlers.execute(), f.handlers.execute()]); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith({ taskId: 'single-task', fileToken: 'zip-target', format: 'csv-zip', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' }, parameters: undefined }); expect(f.context.completed).toBe(true);
    await f.handlers.execute(); expect(f.onExecute).toHaveBeenCalledOnce();
  });
  it('失败后再次新执行必须重新确认，不能当成只重试文件打包', async () => {
    const f = fixture(); f.onExecute.mockRejectedValueOnce(Error('SQL可能已执行')); f.context.acknowledged = true; await f.handlers.execute(); expect(f.context.acknowledged).toBe(false); await f.handlers.execute(); expect(f.onExecute).toHaveBeenCalledOnce();
    f.context.acknowledged = true; await f.handlers.execute(); expect(f.onExecute).toHaveBeenCalledTimes(2);
  });
});
