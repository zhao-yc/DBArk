import { describe, expect, it, vi } from 'vitest';
import { analyzeCompletion } from '../../src/shared/completionAnalysis';
import { completionSuggestions } from '../../src/renderer/completionSuggestions';
import type { CompletionDirectoryRequest, CompletionMetadataOutput } from '../../src/shared/sqlCompletion';
import type { CompletionLexicalMode } from '../../src/shared/completionLexical';
import { CompletionDirectory } from '../../src/renderer/completionDirectory';
import { SessionCompletionDirectory } from '../../src/renderer/sessionCompletionDirectory';

/** 使用真实分析与建议管道，只替换有界目录读取，不连接数据库。 */
async function suggest(marked: string, database: string | null = 'current', mode: CompletionLexicalMode = {}) {
  const source = marked.replace('|', ''), analysis = analyzeCompletion(source, marked.indexOf('|'), mode);
  const load = vi.fn(async (_query: CompletionDirectoryRequest): Promise<CompletionMetadataOutput> => ({ entries: [{ name: 'rebuild', kind: 'procedure' }], incomplete: false }));
  expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') throw Error('真实分析未就绪');
  const result = await completionSuggestions(analysis, database ?? undefined, { load });
  return { source, analysis, result, load };
}

describe('CALL过程名的真实语义缺口', () => {
  it('当前库CALL名称读取现有procedure目录，替换完整suffix且不添加括号或片段', async () => {
    const h = await suggest('CALL re|suffix');
    expect(h.load.mock.calls).toEqual([[{ kind: 'objects', database: 'current', objectKind: 'procedure', prefix: 're' }, undefined]]);
    expect(h.result.items).toEqual([{ label: 'rebuild', kind: 'procedure', insertText: '`rebuild`', detail: '存储过程' }]);
    const item = h.result.items[0]; expect(h.source.slice(0, h.analysis.target.start) + item.insertText + h.source.slice(h.analysis.target.end)).toBe('CALL `rebuild`');
  });
  it('明确限定库只读该库过程，引用名称及已有参数保持原文', async () => {
    const h = await suggest('CALL `lib.x`.`re|suffix`(1)', undefined);
    expect(h.load.mock.calls).toEqual([[{ kind: 'objects', database: 'lib.x', objectKind: 'procedure', prefix: 're' }, undefined]]);
    expect(h.result.items[0]?.insertText).toBe('`rebuild`');
    expect(h.source.slice(0, h.analysis.target.start) + h.result.items[0].insertText + h.source.slice(h.analysis.target.end)).toBe('CALL `lib.x`.`rebuild`(1)');
  });
});

describe('CALL目标、词法模式及目录边界', () => {
  it.each(['CALL |', 'CALL re|suffix()', 'call re|suffix (@out, ABS(1))', '/*说明*/ CALL /*间隔*/ re|suffix(1)', 'SELECT 1; CALL re|suffix(); SELECT 2', 'DELIMITER //\nCALL re|suffix()//'])('仅当前CALL最终名称：%s', async marked => {
    const h = await suggest(marked); expect(h.analysis.syntax).toEqual(['procedure']); expect(h.analysis.relations).toEqual([]); expect(h.analysis.keywords).toEqual([]);
    expect(h.result.items.map(item => item.kind)).toEqual(['procedure']); expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0][0]).toMatchObject({ kind: 'objects', database: 'current', objectKind: 'procedure' });
  });
  it('无默认库不列举全服务器，显式库只读一个目标', async () => {
    const missing = await suggest('CALL re|suffix()', null); expect(missing.load).not.toHaveBeenCalled(); expect(missing.result.items).toEqual([]);
    const named = await suggest('CALL explicit.re|suffix()', null); expect(named.load).toHaveBeenCalledTimes(1); expect(named.load.mock.calls[0][0]).toMatchObject({ database: 'explicit', objectKind: 'procedure' });
  });
  it.each([
    'CALL db.other.re|suffix()', 'CALL db.re|suffix.extra()', 'CALL db|.routine()', 'CALL @re|suffix',
    'CALL re|suffix EXTRA', 'CALL re|suffix() junk', 'CALL re|suffix(', 'CALL re|suffix(1+',
    "CALL re|suffix('未闭合", 'CALL re|suffix(`未闭合',
  ])('非法名称或不完整参数不猜目录：%s', marked => {
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'))).toMatchObject({ status: 'blocked', reason: 'syntax' });
  });
  it.each(['SELECT re|suffix', 'SELECT re|suffix(1)', 'SELECT 1 AS re|suffix', 'CREATE PROCEDURE re|suffix() SELECT 1', 'BEGIN CALL re|suffix(); END'])('其它语句或复合体不进入本切片：%s', marked => {
    const analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    if (analysis.status === 'ready') expect(analysis.syntax).not.toContain('procedure');
  });
  it.each(["CALL routine('re|suffix')", 'CALL routine(1 /* re|suffix */)', 'CALL routine(1) -- re|suffix'])('字符串与注释位置仍由原词法拒绝：%s', marked => {
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')).status).toBe('blocked');
  });
  it.each([
    { ansiQuotes: false, noBackslashEscapes: false }, { ansiQuotes: false, noBackslashEscapes: true },
    { ansiQuotes: true, noBackslashEscapes: false }, { ansiQuotes: true, noBackslashEscapes: true },
  ])('四模式保留引用库及完整替换范围：%j', async mode => {
    const h = await suggest('CALL `lib.x`.`re|suffix`(@out, 1)', null, mode);
    expect(h.analysis.target).toMatchObject({ qualifiers: ['lib.x'], prefix: 're', quoted: true }); expect(h.result.items[0].insertText).toBe('`rebuild`');
  });
  it('ANSI_QUOTES明确才接受双引号名称；未知模式不猜', async () => {
    const marked = 'CALL "lib.x"."re|suffix"()';
    expect((await suggest(marked, null, { ansiQuotes: true })).load.mock.calls[0][0]).toMatchObject({ database: 'lib.x', prefix: 're' });
    for (const mode of [{}, { ansiQuotes: false }]) expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), mode).status).toBe('blocked');
  });
  it('未闭合当前反引号名称仍由原词法拒绝，不扩展恢复范围', () => {
    const marked = 'CALL `re|suffix'; expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')).status).toBe('blocked');
  });
  it('使用现有目录及会话覆盖层，过程读取不探测临时表，也不发送SQL', async () => {
    const marked = "CALL re|suffix('私密参数', @out)", analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    const request = vi.fn(async (_input: unknown): Promise<CompletionMetadataOutput> => ({ entries: [{ name: 're$build`name', kind: 'procedure' }], incomplete: true }));
    const permanent = new CompletionDirectory('connection', 0, { request, cancel: vi.fn(async () => {}), id: () => 'task-call' });
    const lookup = vi.fn(async (): Promise<never> => { throw Error('过程不应读取临时表'); });
    try {
      const result = await completionSuggestions(analysis, 'db', new SessionCompletionDirectory(permanent, lookup, 0));
      expect(request.mock.calls).toEqual([[{ connectionId: 'connection', taskId: 'task-call', kind: 'objects', database: 'db', objectKind: 'procedure', prefix: 're' }]]);
      expect(lookup).not.toHaveBeenCalled(); expect(result).toMatchObject({ incomplete: true, unavailable: false, items: [{ label: 're$build`name', insertText: '`re$build``name`', kind: 'procedure' }] });
      expect(result.items[0].trigger).toBeUndefined(); expect(JSON.stringify(request.mock.calls)).not.toContain('私密参数'); expect(JSON.stringify(analysis)).not.toContain('私密参数');
    } finally { permanent.dispose(); }
  });
  it('CALL参数表达式保留父版无语法候选的边界，不误加入procedure', async () => {
    const marked = 'CALL routine(re|suffix(1))', analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    expect(analysis.syntax).toEqual([]);
    const load = vi.fn(async (): Promise<CompletionMetadataOutput> => ({ entries: [], incomplete: false }));
    expect((await completionSuggestions(analysis, 'db', { load })).items).toEqual([]); expect(load).not.toHaveBeenCalled();
  });
  it('既有SELECT表达式函数仍读取function目录，不混入procedure', async () => {
    const marked = 'SELECT re|suffix(1)', analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    expect(analysis.syntax).toContain('function'); expect(analysis.syntax).not.toContain('procedure');
    const load = vi.fn(async (): Promise<CompletionMetadataOutput> => ({ entries: [{ name: 're_function', kind: 'function' }], incomplete: false }));
    const result = await completionSuggestions(analysis, 'db', { load });
    expect(load.mock.calls).toEqual([[{ kind: 'objects', database: 'db', objectKind: 'function', prefix: 're' }, undefined]]); expect(result.items[0].kind).toBe('function');
  });
  it('取消前零读取，取消后的迟到目录不交付建议', async () => {
    const marked = 'CALL re|suffix()', analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    const controller = new AbortController(), load = vi.fn(async (): Promise<CompletionMetadataOutput> => ({ entries: [], incomplete: false })); controller.abort();
    expect((await completionSuggestions(analysis, 'db', { load }, controller.signal)).items).toEqual([]); expect(load).not.toHaveBeenCalled();
    let resolve!: (value: CompletionMetadataOutput) => void;
    const late = new AbortController(), pending = completionSuggestions(analysis, 'db', { load: () => new Promise(done => { resolve = done; }) }, late.signal);
    late.abort(); resolve({ entries: [{ name: 'rebuild', kind: 'procedure' }], incomplete: false }); expect((await pending).items).toEqual([]);
  });
  it('目录拒绝只显示不可用，不退到函数/表或重试', async () => {
    const marked = 'CALL re|suffix()', analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    const load = vi.fn(async (): Promise<never> => { throw Error('不可输出的认证或服务器细节'); });
    const result = await completionSuggestions(analysis, 'db', { load }); expect(load).toHaveBeenCalledTimes(1); expect(result).toEqual({ items: [], incomplete: true, unavailable: true }); expect(JSON.stringify(result)).not.toContain('不可输出');
  });
  it('前缀和输入大小沿用既有预算', async () => {
    const h = await suggest('CALL ' + 'x'.repeat(65) + '|suffix'); expect(h.load).not.toHaveBeenCalled(); expect(h.result.items).toEqual([]);
    const marked = 'CALL re|suffix' + ' '.repeat(262144); expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'))).toMatchObject({ status: 'blocked', reason: 'budget' });
  });
  it('校验失败不向console回显参数或用户SQL', () => {
    const error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn'), log = vi.spyOn(console, 'log');
    try {
      const marked = "CALL re|suffix('私密参数',)"; analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'));
      expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
    } finally { error.mockRestore(); warn.mockRestore(); log.mockRestore(); }
  });
});
