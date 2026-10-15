import ExcelJS from 'exceljs';
import excelJsPackage from 'exceljs/package.json';
import { PassThrough, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { posix } from 'node:path';
import type { CellValue, DataRow } from '../shared/contracts';
import { EXCEL_LIMITS, type ExcelColumn, type ExcelSheet, type ExcelSheetPreview, type ExcelTextProtocol } from '../shared/excelTransfer';
import { AtomicFile, type AtomicFileIO } from './atomicFile';
import { decodeExcelText, decodeExcelXmlText, encodeExcelCell, encodeExcelXmlText, validateExcelHeaders, validateExcelText } from './excelCellPolicy';
import { ExcelZipArchive } from './excelZipBudget';
import { excelXmlEvents } from './excelXmlReader';

const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const warnings = ['数字单元格保留文件中的原始数值文本；Excel 保存前已发生的精度丢失无法恢复。', '日期样式的数字单元格保留原始日期序列值，请在源文件中转为明确的日期时间文本后导入。', '空白格按 NULL 导入；显式空文本保留为空字符串；不读取公式、外部链接或合并单元格。'];
interface InternalSheet extends ExcelSheet { path: string; }
export interface ExcelReadOptions { filePath: string; checkCancelled?: () => void; }
export interface ExcelSheetReadOptions extends ExcelReadOptions { sheetId: string; protocol: ExcelTextProtocol; expectedFingerprint?: string; }
export interface ExcelExportOptions extends ExcelReadOptions {
  columns: ExcelColumn[]; rows: AsyncIterable<CellValue[]>; onCommitStart: () => void;
  onProgress?: (rows: number) => void; io?: AtomicFileIO;
}

/** 固定 ExcelJS 4.4.0 的内部流适配，仅替换无背压的 StreamBuf，不改 XML 编码和 ZIP 格式实现。 */
interface StreamingWriterInternals {
  _openStream(path: string): PassThrough;
  zip: PassThrough & { append(stream: PassThrough, options: { name: string }): void; abort(): void };
}

/** 表数据逐行写入真实 XLSX；旧文件仅在完整 ZIP 写完、fsync 和最后一次取消检查之后替换。 */
export async function exportExcelFile(input: ExcelExportOptions): Promise<{ rows: number; bytes: number }> {
  const check = input.checkCancelled ?? (() => undefined);
  if (excelJsPackage.version !== '4.4.0') throw new Error('Excel 流适配需要重新验证当前 ExcelJS 版本');
  validateExcelHeaders(input.columns.map(column => column.name));
  const atomic = await AtomicFile.create(input.filePath, 'utf8', check, input.onCommitStart, input.io, EXCEL_LIMITS.maxCompressedBytes);
  const streams: PassThrough[] = [], pendingWrites = new Set<Promise<void>>();
  let streamError: Error | undefined, totalXml = 0;
  const sink = new Writable({ highWaterMark: 64 * 1024,
    /** Writable 回调在实际磁盘写入后完成，背压才能传回 ZIP 和行生产者。 */
    write(chunk: Buffer, _encoding, callback) {
      const promise = atomic.writeBytes(chunk); pendingWrites.add(promise);
      void promise.then(() => { pendingWrites.delete(promise); callback(); }, reason => { pendingWrites.delete(promise); callback(reason as Error); });
    }
  });
  const sinkDone = finished(sink, { cleanup: true }); void sinkDone.catch(() => undefined);
  sink.on('error', error => { streamError = error; });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useSharedStrings: false, useStyles: false, zip: { zlib: { level: 6 } } });
  const internals = workbook as unknown as StreamingWriterInternals;
  if (typeof internals._openStream !== 'function' || typeof internals.zip?.append !== 'function' || typeof internals.zip?.abort !== 'function') { sink.destroy(); await sinkDone.catch(() => undefined); await atomic.dispose(); throw new Error('ExcelJS 流写入接口已变化，需要重新验证'); }
  const zipDone = finished(internals.zip, { cleanup: true }); void zipDone.catch(() => undefined);
  internals.zip.on('error', error => { streamError = error; sink.destroy(error); });
  const cancellationTimer = setInterval(() => {
    try { check(); }
    catch (reason) { const error = reason instanceof Error ? reason : new Error('Excel 导出已取消'); streamError = error; sink.destroy(error); internals.zip.destroy(error); for (const stream of streams) stream.destroy(error); }
  }, 25);
  internals._openStream = path => {
    const stream = new PassThrough({ highWaterMark: 64 * 1024 }); streams.push(stream);
    const nativeWrite = stream.write.bind(stream);
    // ExcelJS 重用内部 StringBuf，必须立刻复制其字节，不能让后续行修改待写 XML。
    stream.write = ((chunk: string | Buffer | { toBuffer(): Buffer }, ...args: unknown[]) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk.toBuffer());
      totalXml += bytes.length;
      if (totalXml > EXCEL_LIMITS.maxEntryBytes) throw new Error('Excel 工作表展开内容超过 256 MiB，请改用其他格式');
      return (nativeWrite as (...arguments_: unknown[]) => boolean)(bytes, ...args);
    }) as typeof stream.write;
    stream.on('error', error => { streamError = error; });
    internals.zip.append(stream, { name: path.replace(/^\//, '') });
    stream.on('finish', () => stream.emit('zipped'));
    return stream;
  };
  let count = 0;
  try {
    const worksheet = workbook.addWorksheet('数据');
    const xmlStream = (worksheet as unknown as { stream: PassThrough }).stream;
    /** 一行提交后等待 Node 背压解除，同时观察取消和实际写入错误。 */
    async function settleRow(): Promise<void> {
      check(); if (streamError) throw streamError;
      if (xmlStream.writableNeedDrain) await new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => { try { check(); if (streamError) throw streamError; } catch (error) { cleanup(); reject(error); } }, 25);
        const cleanup = () => { clearInterval(timer); xmlStream.off('drain', drained); xmlStream.off('error', failed); };
        const drained = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        xmlStream.once('drain', drained); xmlStream.once('error', failed);
      });
      check(); if (streamError) throw streamError;
    }
    if (input.columns.reduce((bytes, column) => bytes + Buffer.byteLength(column.name), 0) > EXCEL_LIMITS.maxRowBytes) throw new Error('Excel 标题行超过 1 MiB');
    // 单段 inlineStr 保持文字语义，并让 Excel 与 ExcelJS 都按 ST_Xstring 解码回车和字面转义标记。
    const textCell = (value: string | boolean) => typeof value === 'string' ? { richText: [{ text: encodeExcelXmlText(value) }] } : value;
    worksheet.addRow(input.columns.map(column => textCell(column.name))).commit(); await settleRow();
    for await (const row of input.rows) {
      check();
      if (++count >= EXCEL_LIMITS.maxRows || count * input.columns.length > EXCEL_LIMITS.maxCells) throw new Error('Excel 行数或单元格总数超过上限，请拆分导出');
      if (row.length !== input.columns.length) throw new Error('导出行与字段数量不一致');
      const values = row.map((value, index) => encodeExcelCell(value, input.columns[index]));
      if (values.reduce((bytes, value) => bytes + Buffer.byteLength(String(value)), 0) > EXCEL_LIMITS.maxRowBytes) throw new Error('Excel 单行文本超过 1 MiB，请改用其他格式');
      worksheet.addRow(values.map(textCell)).commit(); await settleRow();
      if (count % 100 === 0) input.onProgress?.(count);
    }
    worksheet.commit(); await Promise.all([workbook.commit(), sinkDone]);
    check(); await atomic.commit(); input.onProgress?.(count);
    return { rows: count, bytes: atomic.bytesWritten };
  } finally {
    clearInterval(cancellationTimer);
    // 停止 ZIP 生产和所有流后等待在途真实写入，最后才释放独占临时文件与目标锁。
    internals.zip.abort(); internals.zip.destroy();
    for (const stream of streams) stream.destroy();
    sink.destroy();
    await Promise.allSettled([sinkDone, zipDone, ...pendingWrites]);
    await atomic.dispose();
  }
}

/** 关系目标按 OPC 相对路径解析，拒绝文件系统路径、外链和包外跳转。 */
function relationshipPath(target: string): string {
  if (!target || /[\\\u0000-\u001f:#?]/.test(target)) throw new Error('XLSX 工作表关系目标无效');
  const path = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('xl', target));
  if (!path.startsWith('xl/') || path.includes('../')) throw new Error('XLSX 工作表关系超出包范围');
  return path;
}

/** 所有关系文件先拒绝外链，宏和嵌入对象不进入数据导入。 */
async function inspectWorkbook(zip: ExcelZipArchive): Promise<InternalSheet[]> {
  await zip.audit();
  const relations = new Map<string, string>();
  for (const name of zip.entries.keys()) {
    if (/vbaproject|(?:^|\/)embeddings\/|(?:^|\/)externallinks\//i.test(name)) throw new Error('不支持包含宏、嵌入对象或外部链接的工作簿');
    if (!name.endsWith('.rels')) continue;
    for await (const event of excelXmlEvents(zip, name)) {
      if (event.kind !== 'open' || event.name !== 'Relationship' || event.uri !== packageNs) continue;
      if (event.attributes.TargetMode && event.attributes.TargetMode !== 'Internal') throw new Error('工作簿包含外部链接，导入已拒绝');
      if (name === 'xl/_rels/workbook.xml.rels' && event.attributes.Type === `${relationshipNs}/worksheet`) {
        const id = event.attributes.Id;
        if (!id || relations.has(id)) throw new Error('XLSX 工作表关系编号无效或重复');
        relations.set(id, relationshipPath(event.attributes.Target));
      }
    }
  }
  const sheets: InternalSheet[] = [], ids = new Set<string>(), names = new Set<string>();
  for await (const event of excelXmlEvents(zip, 'xl/workbook.xml')) {
    if (event.kind !== 'open' || event.name !== 'sheet' || event.uri !== sheetNs) continue;
    const id = event.attributes.sheetId, name = event.attributes.name;
    const path = relations.get(event.attributes[`{${relationshipNs}}id`]);
    if (!id || !name || !path || !zip.entries.has(path) || ids.has(id) || names.has(name)) throw new Error('XLSX 工作表元数据无效或重复');
    if (sheets.length >= EXCEL_LIMITS.maxSheets) throw new Error('工作簿最多支持 64 张工作表');
    validateExcelText(name); ids.add(id); names.add(name);
    sheets.push({ id, name, path, hidden: ['hidden', 'veryHidden'].includes(event.attributes.state) });
  }
  if (!sheets.length) throw new Error('未找到可导入的 XLSX 工作表');
  return sheets;
}

/** 共享字符串只缓存明确预算内的文字；逐个 si 拼接富文本，不解释样式或 phonetic 注释。 */
async function sharedStrings(zip: ExcelZipArchive): Promise<string[]> {
  if (!zip.entries.has('xl/sharedStrings.xml')) return [];
  const strings: string[] = []; let text = '', runText = '', inItem = false, inText = false, phonetic = 0, bytes = 0;
  for await (const event of excelXmlEvents(zip, 'xl/sharedStrings.xml')) {
    if (event.kind === 'text') {
      if (inItem && inText && !phonetic) { runText += event.text; if (runText.length > EXCEL_LIMITS.maxCellCharacters * 7) throw new Error('XLSX 单元格文本超过长度上限'); }
      continue;
    }
    if (event.uri !== sheetNs) continue;
    if (event.kind === 'open') {
      if (event.name === 'si') { if (inItem) throw new Error('XLSX 共享字符串结构无效'); inItem = true; text = ''; }
      if (event.name === 't') { inText = true; runText = ''; }
      if (event.name === 'rPh') phonetic++;
    } else {
      if (event.name === 't') { if (!phonetic) { text += decodeExcelXmlText(runText); validateExcelText(text); } inText = false; }
      if (event.name === 'rPh') phonetic--;
      if (event.name === 'si') {
        bytes += Buffer.byteLength(text);
        if (strings.length >= EXCEL_LIMITS.maxSharedStrings || bytes > EXCEL_LIMITS.maxSharedStringBytes) throw new Error('XLSX 共享字符串缓存超过上限（10 万项或 16 MiB）');
        strings.push(text); inItem = false;
      }
    }
  }
  return strings;
}

/** 单元格坐标不能靠稀疏数组分配绕过列数和行数上限。 */
function cellCoordinate(reference: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(reference);
  if (!match) throw new Error('XLSX 单元格坐标无效');
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > EXCEL_LIMITS.maxColumns || row > EXCEL_LIMITS.maxRows) throw new Error('XLSX 单元格坐标超过 Excel 上限');
  return { row, column };
}

/** 保留 n 单元格原始 token，不经过 Number；公式、错误值和不支持类型均明确报错。 */
function readCell(type: string, text: string, strings: string[], hasValue: boolean, protocol: ExcelTextProtocol): CellValue {
  if (type === 'inlineStr' || type === 'str' || type === 'd') return decodeExcelText(type === 'str' ? decodeExcelXmlText(text) : text, protocol);
  if (!hasValue) return null;
  if (type === 's') {
    if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error('XLSX 共享字符串索引无效');
    const index = Number(text);
    if (!Number.isSafeInteger(index) || index >= strings.length) throw new Error('XLSX 共享字符串索引越界');
    return decodeExcelText(strings[index], protocol);
  }
  if (type === 'b') { if (text !== '0' && text !== '1') throw new Error('XLSX 布尔值无效'); return text === '1'; }
  if (type === 'n' || type === '') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('XLSX 数字单元格无效');
    return text;
  }
  throw new Error('XLSX 包含错误单元格或不支持的单元格类型');
}

/** 逐行解析所选表，空白格为 NULL，显式空文本为字符串；完全空行保持为空数据行。 */
async function* sheetRows(zip: ExcelZipArchive, sheet: InternalSheet, strings: string[], protocol: ExcelTextProtocol): AsyncGenerator<CellValue[]> {
  let row: CellValue[] | undefined, rowIndex = 0, lastColumn = 0, cells = 0, rowBytes = 0;
  let cell: { column: number; type: string; text: string; hasValue: boolean } | undefined;
  let inValue = false, inText = false, phonetic = 0, runText = '';
  const stack: string[] = []; let sawSheetData = false;
  for await (const event of excelXmlEvents(zip, sheet.path)) {
    if (event.kind === 'text') {
      if (cell && inValue) { cell.text += event.text; if (cell.text.length > EXCEL_LIMITS.maxCellCharacters * 7) throw new Error('XLSX 单元格文本超过长度上限'); }
      if (cell && inText && !phonetic) { runText += event.text; if (runText.length > EXCEL_LIMITS.maxCellCharacters * 7) throw new Error('XLSX 单元格文本超过长度上限'); }
      continue;
    }
    const parent = stack.at(-1);
    if (event.kind === 'open') {
      if (!stack.length && (event.name !== 'worksheet' || event.uri !== sheetNs)) throw new Error('XLSX 工作表根元素无效');
      stack.push(`${event.uri}:${event.name}`);
    } else stack.pop();
    if (event.uri !== sheetNs) continue;
    if (event.kind === 'open') {
      if (event.name === 'sheetData') { if (parent !== `${sheetNs}:worksheet` || sawSheetData) throw new Error('XLSX 工作表数据区无效'); sawSheetData = true; }
      if (event.name === 'f') throw new Error('工作表包含公式；请在 Excel 中粘贴为值后再导入');
      if (event.name === 'mergeCell') throw new Error('工作表包含合并单元格，请取消合并后再导入');
      if (event.name === 'row') {
        if (parent !== `${sheetNs}:sheetData`) throw new Error('XLSX 数据行不在工作表数据区');
        const next = event.attributes.r === undefined ? rowIndex + 1 : Number(event.attributes.r);
        if (row || !Number.isInteger(next) || next <= rowIndex || next > EXCEL_LIMITS.maxRows) throw new Error('XLSX 行序号无效或超限');
        rowIndex = next; row = []; lastColumn = 0; rowBytes = 0;
      }
      if (event.name === 'c') {
        if (parent !== `${sheetNs}:row` || !row || cell) throw new Error('XLSX 单元格结构无效');
        const coordinate = event.attributes.r ? cellCoordinate(event.attributes.r) : { row: rowIndex, column: lastColumn + 1 };
        if (coordinate.row !== rowIndex || coordinate.column <= lastColumn || coordinate.column > EXCEL_LIMITS.maxColumns) throw new Error('XLSX 单元格顺序无效');
        cell = { column: coordinate.column, type: event.attributes.t ?? '', text: '', hasValue: false }; lastColumn = coordinate.column;
      }
      if (event.name === 'v') { if (parent !== `${sheetNs}:c` || !cell || cell.hasValue || cell.type === 'inlineStr') throw new Error('XLSX 单元格包含重复或游离的值'); inValue = true; cell.hasValue = true; }
      if (event.name === 't') { inText = true; runText = ''; if (cell) cell.hasValue = true; }
      if (event.name === 'rPh') phonetic++;
    } else {
      if (event.name === 'v') inValue = false;
      if (event.name === 't') { if (cell && !phonetic) { cell.text += decodeExcelXmlText(runText); validateExcelText(cell.text); } inText = false; }
      if (event.name === 'rPh') phonetic--;
      if (event.name === 'c') {
        if (!cell || !row) throw new Error('XLSX 单元格结构无效');
        while (row.length < cell.column - 1) row.push(null);
        const value = readCell(cell.type, cell.text, strings, cell.hasValue, protocol);
        rowBytes += value === null ? 0 : Buffer.byteLength(typeof value === 'object' ? value.base64 : String(value));
        if (rowBytes > EXCEL_LIMITS.maxRowBytes) throw new Error('Excel 单行文本超过 1 MiB');
        row.push(value); cell = undefined;
      }
      if (event.name === 'row') { if (!row || cell) throw new Error('XLSX 行结构无效'); cells += row.length; if (cells > EXCEL_LIMITS.maxCells) throw new Error('XLSX 单元格总数超过 500 万'); yield row; row = undefined; }
    }
  }
  if (!sawSheetData) throw new Error('XLSX 工作表缺少数据区');
}

/** 工作表清单在 ZIP 全量流式安全校验后返回，不暴露关系路径。 */
export async function listExcelSheets(input: ExcelReadOptions): Promise<ExcelSheet[]> {
  const zip = await ExcelZipArchive.open(input.filePath, input.checkCancelled);
  try { return (await inspectWorkbook(zip)).map(({ id, name, hidden }) => ({ id, name, hidden })); }
  finally { await zip.close(); }
}

/** 原始标题与数据协议分开，__proto__ 等合法字段通过 null 原型对象保留。 */
export async function* readExcelRows(input: ExcelSheetReadOptions): AsyncGenerator<DataRow> {
  const zip = await ExcelZipArchive.open(input.filePath, input.checkCancelled);
  try {
    if (input.expectedFingerprint !== undefined && await zip.fingerprint() !== input.expectedFingerprint) throw new Error('工作簿自预览后已发生变化，请重新预览并确认字段映射');
    const sheet = (await inspectWorkbook(zip)).find(item => item.id === input.sheetId);
    if (!sheet) throw new Error('所选工作表不存在，请重新预览');
    const strings = await sharedStrings(zip);
    let headers: string[] | undefined, records = 0;
    // 标题必须按原始文本读取；数据协议在按标题形成记录时应用。
    for await (const values of sheetRows(zip, sheet, strings, 'plain')) {
      if (!headers) { headers = validateExcelHeaders(values.map(value => value === null || typeof value === 'object' ? '' : String(value))); continue; }
      if (values.length > headers.length) throw new Error('Excel 数据行超出标题字段范围');
      if (++records * headers.length > EXCEL_LIMITS.maxCells) throw new Error('XLSX 映射后的单元格总数超过 500 万');
      const row: DataRow = Object.create(null);
      headers.forEach((name, index) => {
        const value = index < values.length ? values[index] : null;
        row[name] = typeof value === 'string' ? decodeExcelText(value, input.protocol) : value;
      });
      yield row;
    }
    if (!headers) throw new Error('工作表为空或缺少标题行');
  } finally { await zip.close(); }
}

/** 预览只保留 20 行，但完整流式校验所选表，防止后部公式/合并在开始导入后才被发现。 */
export async function previewExcelSheet(input: ExcelSheetReadOptions): Promise<ExcelSheetPreview> {
  const zip = await ExcelZipArchive.open(input.filePath, input.checkCancelled);
  try {
    const fingerprint = await zip.fingerprint();
    const sheet = (await inspectWorkbook(zip)).find(item => item.id === input.sheetId);
    if (!sheet) throw new Error('所选工作表不存在，请重新预览');
    const strings = await sharedStrings(zip), rows: DataRow[] = [];
    let columns: string[] | undefined, records = 0;
    for await (const values of sheetRows(zip, sheet, strings, 'plain')) {
      if (!columns) { columns = validateExcelHeaders(values.map(value => value === null || typeof value === 'object' ? '' : String(value))); continue; }
      if (values.length > columns.length) throw new Error('Excel 数据行超出标题字段范围');
      if (++records * columns.length > EXCEL_LIMITS.maxCells) throw new Error('XLSX 映射后的单元格总数超过 500 万');
      const row: DataRow = Object.create(null);
      columns.forEach((name, index) => { const value = index < values.length ? values[index] : null; row[name] = typeof value === 'string' ? decodeExcelText(value, input.protocol) : value; });
      if (rows.length < EXCEL_LIMITS.previewRows) rows.push(row);
    }
    if (!columns) throw new Error('工作表为空或缺少标题行');
    return { sheet: { id: sheet.id, name: sheet.name, hidden: sheet.hidden }, columns, rows, warnings, fingerprint };
  } finally { await zip.close(); }
}
