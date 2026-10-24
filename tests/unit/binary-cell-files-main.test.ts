import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import ts from 'typescript';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { readBinaryCellFile, writeBinaryCellFile } from '../../src/main/binaryCellFiles';
import { binaryCellFileText } from '../../src/shared/binaryCellFiles';
import { ExportReservations } from '../../src/main/exportReservations';

let main: ReturnType<typeof mainColumnsHarness>, directory: string;
const bytes = Buffer.from('EFBBBF00FF22275C0D0AE4B8AD', 'hex');

/** 真实IPC/dispatch及文件IO，只替换Electron选择器；退出等待函数同样从生产AST提取。 */
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-binary-cell-files-main-'));
  main = mainColumnsHarness();
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'queryFileOperation');
  if (!declaration) throw Error('未找到真实退出文件等待函数');
  Object.assign(main.context, { queryFileOperations: new Set(), binaryCellFileActive: false, binaryCellFileText, readBinaryCellFile, writeBinaryCellFile, exportReservations: new ExportReservations(), dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } });
  runInContext(ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, main.context);
  main.request.mockImplementation(async () => { throw Error('二进制文件禁止调用Engine'); });
});
/** 仅清理本例自建的隔离临时目录。 */
afterEach(async () => { await rm(directory, { recursive: true }); vi.restoreAllMocks(); });
const openDialog = () => main.context.dialog.showOpenDialog as ReturnType<typeof vi.fn>;
const saveDialog = () => main.context.dialog.showSaveDialog as ReturnType<typeof vi.fn>;

describe('二进制单元格真实Main入口', () => {
  it('精确载入BOM/NUL/FF及零字节，回执只有basename和完整字节', async () => {
    const path = join(directory, '完整.bin'); await writeFile(path, bytes);
    openDialog().mockResolvedValue({ canceled: false, filePaths: [path] });
    expect(await main.run('binaryCellFiles.open', {})).toEqual({ base64: bytes.toString('base64'), bytes: bytes.length, name: '完整.bin' });
    await writeFile(path, Buffer.alloc(0));
    expect(await main.run('binaryCellFiles.open', {})).toEqual({ base64: '', bytes: 0, name: '完整.bin' });
    expect(openDialog().mock.calls[0][1]).toEqual({ title: binaryCellFileText.openTitle, properties: ['openFile'], filters: [{ name: binaryCellFileText.allFiles, extensions: ['*'] }] });
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0); expect(main.context.files.size).toBe(0); expect(main.context.queryFileOperations.size).toBe(0);
  });

  it('另存完整原值及空文件，释放实际目标占用，不建任务或文件token', async () => {
    const path = join(directory, '输出.bin'); await writeFile(path, '原文件');
    saveDialog().mockResolvedValue({ canceled: false, filePath: path });
    expect(await main.run('binaryCellFiles.save', { base64: bytes.toString('base64'), suggestedName: 'binary-cell.bin' })).toEqual({ bytes: bytes.length, name: '输出.bin' });
    expect(await readFile(path)).toEqual(bytes);
    expect(await main.run('binaryCellFiles.save', { base64: '' })).toEqual({ bytes: 0, name: '输出.bin' });
    expect(await readFile(path)).toEqual(Buffer.alloc(0)); expect(await readdir(directory)).toEqual(['输出.bin']);
    expect(saveDialog().mock.calls[0][1]).toEqual({ title: binaryCellFileText.saveTitle, defaultPath: binaryCellFileText.defaultName, filters: [{ name: binaryCellFileText.allFiles, extensions: ['*'] }] });
    const release = await main.context.exportReservations.acquire(path); release();
    expect(main.request).not.toHaveBeenCalled(); expect(main.tasks.size).toBe(0); expect(main.context.files.size).toBe(0);
  });

  it('取消两个选择器均不读取或写入文件', async () => {
    const path = join(directory, '保留.bin'); await writeFile(path, bytes);
    openDialog().mockResolvedValue({ canceled: true, filePaths: [path] }); saveDialog().mockResolvedValue({ canceled: true, filePath: path });
    expect(await main.run('binaryCellFiles.open', {})).toBe(null); expect(await main.run('binaryCellFiles.save', { base64: '' })).toBe(null);
    expect(await readFile(path)).toEqual(bytes); expect(main.context.queryFileOperations.size).toBe(0);
  });

  it('实际校验拒绝路径、getter、继承字段及不规范Base64，选择器零调用', async () => {
    const getter = vi.fn(() => bytes.toString('base64')), access = Object.defineProperty({}, 'base64', { get: getter, enumerable: true });
    for (const input of [{ base64: '', path: '任意路径' }, { base64: 'AB==' }, { base64: '', suggestedName: '../外部.bin' }, Object.create({ base64: '' }), access]) expect((await main.invoke('binaryCellFiles.save', input)).ok).toBe(false);
    expect((await main.invoke('binaryCellFiles.open', { path: '任意路径' })).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(openDialog()).not.toHaveBeenCalled(); expect(saveDialog()).not.toHaveBeenCalled();
  });

  it.each(['frame', 'origin', 'shutdown'] as const)('%s来源失败不能打开选择器', async kind => {
    const sender = main.event();
    if (kind === 'frame') sender.senderFrame = { ...sender.senderFrame };
    if (kind === 'origin') sender.senderFrame.url = 'app://其它文档';
    if (kind === 'shutdown') main.context.shuttingDown = true;
    expect((await main.invoke('binaryCellFiles.open', {}, sender)).ok).toBe(false); expect(openDialog()).not.toHaveBeenCalled();
  });

  it.each(['open', 'save'] as const)('等待%s时保持退出集合与互斥，导航后不碰所选文件', async kind => {
    const path = join(directory, '保留.bin'), wait = deferred(); await writeFile(path, bytes);
    (kind === 'open' ? openDialog() : saveDialog()).mockReturnValue(wait.promise);
    const operation = main.invoke('binaryCellFiles.' + kind, kind === 'open' ? {} : { base64: '' });
    expect(main.context.queryFileOperations.size).toBe(1);
    expect((await main.invoke('binaryCellFiles.open', {})).ok).toBe(false);
    main.windows[0].webContents.mainFrame.url = 'app://新文档';
    wait.resolve(kind === 'open' ? { canceled: false, filePaths: [path] } : { canceled: false, filePath: path });
    expect((await operation).ok).toBe(false); expect(await readFile(path)).toEqual(bytes); expect(await readdir(directory)).toEqual(['保留.bin']);
    expect(main.context.queryFileOperations.size).toBe(0); expect(main.context.binaryCellFileActive).toBe(false);
  });

  it('导出目标已占用时拒绝覆盖，锁恢复后可明确重新保存', async () => {
    const path = join(directory, '保留.bin'); await writeFile(path, bytes); saveDialog().mockResolvedValue({ canceled: false, filePath: path });
    const release = await main.context.exportReservations.acquire(path);
    expect((await main.invoke('binaryCellFiles.save', { base64: '' })).ok).toBe(false); expect(await readFile(path)).toEqual(bytes);
    release(); await main.run('binaryCellFiles.save', { base64: '' }); expect((await readFile(path)).length).toBe(0); expect(main.context.queryFileOperations.size).toBe(0);
  });
});
