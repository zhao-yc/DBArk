import { desktop, expect } from './desktop-fixture';

type SnapshotRoot = typeof globalThis & { __dbarkNativeClipboardSnapshot?: { items: Electron.ClipboardItem[]; text: string } };

/** 回调直接序列化到主进程；全部可读格式只保存在该进程内存，不写报告或磁盘。 */
async function capture({ clipboard, ClipboardItem }: typeof import('electron')) {
  const root = globalThis as SnapshotRoot;
  if (root.__dbarkNativeClipboardSnapshot) throw Error('不能交叉占用原生剪贴板');
  const entries = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))));
  root.__dbarkNativeClipboardSnapshot = { items: entries.map(entry => new ClipboardItem(entry)), text: await clipboard.readText() };
}

/** 空壳两端一致忽略，有类型的零字节值仍须逐格式逐字节恢复。 */
async function restore({ clipboard }: typeof import('electron')) {
  const root = globalThis as SnapshotRoot, saved = root.__dbarkNativeClipboardSnapshot;
  if (!saved) throw Error('原生剪贴板快照丢失');
  if (saved.items.length) await clipboard.write(saved.items); else clipboard.clear();
  const actual = (await clipboard.read()).filter(item => item.types.length);
  let same = actual.length === saved.items.length;
  for (let index = 0; same && index < saved.items.length; index++) for (const type of saved.items[index].types) {
    if (!actual[index].types.includes(type)) { same = false; break; }
    const before = await saved.items[index].getType(type), after = await actual[index].getType(type);
    same &&= 'arrayBuffer' in before && 'arrayBuffer' in after ? Buffer.from(await before.arrayBuffer()).equals(Buffer.from(await after.arrayBuffer())) : JSON.stringify(before) === JSON.stringify(after);
  }
  same &&= await clipboard.readText() === saved.text;
  delete root.__dbarkNativeClipboardSnapshot;
  return same;
}

/** 原操作和恢复均失败时保留两份原因，避免finally掩盖产品或定位异常。 */
export async function withNativeClipboard(body: () => Promise<void>): Promise<void> {
  await desktop.evaluate(capture);
  let failed = false, operationError: unknown;
  try { await body(); } catch (error) { failed = true; operationError = error; throw error; }
  finally {
    try { expect(await desktop.evaluate(restore), '原剪贴板全部可读格式和纯文本必须恢复').toBe(true); }
    catch (restoreError) { if (failed) throw new AggregateError([operationError, restoreError], '原生剪贴板操作及恢复均失败', { cause: operationError }); throw restoreError; }
  }
}
