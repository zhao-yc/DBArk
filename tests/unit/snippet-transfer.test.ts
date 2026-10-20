import { describe, expect, it } from 'vitest';
import { decodeSnippetTransfer as decode, encodeSnippetTransfer as encode, previewSnippetTransfer, snippetTransferLimits, validateSnippetCollection } from '../../src/shared/snippetTransfer';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { SqlSnippet } from '../../src/shared/contracts';

export const sample: SqlSnippet = { id: '用户一', name: '中文 🚢', group: '分组', description: '独立说明', sql: " \r\n-- ${不插值}\nSELECT '$1', '\\', '🚢';\r\n", updatedAt: '' };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const file = (snippets: unknown) => ({ format: 'DBArk-snippets', version: 1, snippets });
describe('片段交换版本、预算与无损正文', () => {
  it('UTF-8与可选文件BOM往返保留SQL、混合换行、空白、模板符号和Unicode', () => {
    const text = encode([sample]); expect(decode(new TextEncoder().encode(text))).toEqual([sample]);
    expect(decode(new TextEncoder().encode('\ufeff' + text))).toEqual([sample]); expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'version', 'snippets']);
  });
  it.each([{}, { ...file([sample]), version: 2 }, { ...file([sample]), credentials: '不允许' }, file([{ ...sample, password: '不允许' }]), file([{ ...sample, sql: ' ' }]), file([{ ...sample, name: 'x'.repeat(101) }]), file([{ ...sample, description: 'x'.repeat(2001) }]), file([{ ...sample, group: 'x'.repeat(101) }]), file([{ ...sample, sql: 'x'.repeat(65537) }]), file([sample, sample]), file([{ ...sample, id: 'builtin-select' }])])('严格拒绝未知版本/字段、预算或重复与保留ID：%j', value => {
    expect(() => decode(bytes(value))).toThrow();
  });
  it('拒绝非UTF-8与超4MiB整个文件；500条恰好可用，501条拒绝', () => {
    expect(() => decode(Uint8Array.from([0xc0, 0xaf]))).toThrow(); expect(() => decode(new Uint8Array(snippetTransferLimits.bytes + 1))).toThrow();
    const rows = Array.from({ length: 500 }, (_, i) => ({ ...sample, id: String(i) })); expect(decode(bytes(file(rows)))).toHaveLength(500); expect(() => encode([...rows, { ...sample, id: '501' }])).toThrow();
    const large = Array.from({ length: 65 }, (_, i) => ({ ...sample, id: String(i), sql: 'x'.repeat(65536) })); expect(() => validateSnippetCollection(large)).toThrow();
    const escaped = Array.from({ length: 64 }, (_, i) => ({ ...sample, id: String(i), sql: '\n'.repeat(65536) })); expect(() => encode(escaped)).toThrow();
  });
  it('同ID比较正文并显示原内容；同名不同ID及内置同名只提示，不自动映射', () => {
    const result = previewSnippetTransfer([sample], [{ ...sample, sql: 'SELECT 2' }, { ...sample, id: '副本' }, { ...sample, id: '内置副本', name: '按条件读取列' }]);
    expect(result.map(e => e.status)).toEqual(['replace', 'add', 'add']); expect(result[0].previous).toEqual(sample); expect(result[0].warnings).toHaveLength(1); expect(result[1].warnings).toHaveLength(1); expect(result[2].warnings).toHaveLength(1);
    expect(previewSnippetTransfer([sample], [{ ...sample, updatedAt: '其他时间' }])[0].status).toBe('same');
  });
  it('全部五项受控IPC具备白名单与严格schema，不接受renderer路径或SQL替换正文', () => {
    const scopeId = '12345678-1234-4234-8234-123456789abc';
    for (const command of ['snippets.transferOpen', 'snippets.transferPreview', 'snippets.transferExport', 'snippets.transferCancel', 'snippets.transferApply'] as const) {
      expect(publicCommands[command]).toBe(true); const input = command.endsWith('Open') ? {} : command.endsWith('Apply') ? { scopeId, previewId: scopeId, decisions: [] } : { scopeId };
      expect(validateCommand(command, input)).toEqual(input); expect(() => validateCommand(command, { ...input, path: '任意路径' })).toThrow();
    }
    expect(() => validateCommand('snippets.transferApply', { scopeId, previewId: scopeId, decisions: [{ id: sample.id, action: 'replace', sql: 'SELECT 9' }] })).toThrow();
  });
});
