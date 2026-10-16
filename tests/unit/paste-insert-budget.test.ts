import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { decodeClipboard, parseTabularText } from '../../src/renderer/gridClipboard';
import { decodePasteInsert } from '../../src/renderer/pasteInsert';
import { pasteInsertZh } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 执行真实解码源码；只在独立VM观察map及矩阵行push，不修改生产源码或宿主内建方法。 */
function allocationProbe() {
  const port = createContext({ zh, pasteInsertZh });
  runInContext(`globalThis.rowMaps=0;globalThis.rowPushes=0;
    const originalMap=Array.prototype.map,originalPush=Array.prototype.push;
    Array.prototype.map=function(...args){rowMaps++;return Reflect.apply(originalMap,this,args)};
    Array.prototype.push=function(...args){if(args.length===1&&Array.isArray(args[0]))rowPushes++;return Reflect.apply(originalPush,this,args)};`, port);
  for (const [file, name] of [['gridClipboard.ts', 'clipboard'], ['pasteInsert.ts', 'paste']]) {
    const source = readFileSync(new URL('../../src/renderer/' + file, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInContext(`{const module={exports:{}};const require=name=>name==='./gridClipboard'?globalThis.clipboard:name.includes('pasteInsert.zh-CN')?{pasteInsertZh}:name.includes('zh-CN')?{zh}:{};(function(require,module,exports){${compiled}\n})(require,module,module.exports);globalThis.${name}=module.exports;}`, port);
  }
  return port;
}

describe('批量新增在矩阵分配前限制行数', () => {
  it('36022字符typed的12000空行在逐行map前拒绝，空行不能绕过50k单元上限', () => {
    const port = allocationProbe(), typed = '{"version":1,"rows":[' + Array(12000).fill('[]').join(',') + ']}';
    expect(typed.length).toBe(36022);
    expect(() => port.paste.decodePasteInsert(typed, '不能回退')).toThrow(/1000/);
    expect(port.rowMaps).toBe(0); expect(port.rowPushes).toBe(0);
  });
  it('12000个TSV空行在矩阵行push前拒绝，不先构建再丢弃12000行', () => {
    const port = allocationProbe();
    expect(() => port.paste.decodePasteInsert('', '\n'.repeat(12000))).toThrow(/1000/);
    expect(port.rowPushes).toBe(0); expect(port.rowMaps).toBe(0);
  });
  it.each(['\n', '\r', '\r\n'])('1000个%s分隔行及结尾分隔保持，1001行拒绝', newline => {
    expect(decodePasteInsert('', ('x' + newline).repeat(1000))).toHaveLength(1000);
    expect(() => decodePasteInsert('', ('x' + newline).repeat(1000) + 'x')).toThrow(/1000/);
  });
  it('引号内12000换行、转义双引号和制表符仍为一个单元，原字符串精度不变', () => {
    const value = '900719925474099312345\n'.repeat(12000) + '"\t2026-10-16 12:34:56.123456';
    const plain = '"' + value.replaceAll('"', '""') + '"';
    expect(decodePasteInsert('', plain)).toEqual([[value]]);
  });
  it('短文本穷举沿原词法计数，包含引号、空单元、CR/LF及末尾空引号', () => {
    const alphabet = ['x', '"', '\t', '\r', '\n'], values = [''];
    for (let length = 0, start = 0; length < 5; length++) { const end = values.length; for (let index = start; index < end; index++) for (const char of alphabet) values.push(values[index] + char); start = end; }
    for (const plain of values) {
      let original: string[][]; try { original = parseTabularText(plain); } catch { expect(() => decodeClipboard('', plain, { maximum: 2, message: pasteInsertZh.rowLimit })).toThrow(); continue; }
      if (original.length > 2) expect(() => decodeClipboard('', plain, { maximum: 2, message: pasteInsertZh.rowLimit })).toThrow(/1000/);
      else expect(decodeClipboard('', plain, { maximum: 2, message: pasteInsertZh.rowLimit })).toEqual(original);
    }
    expect(values).toHaveLength(3906);
  });
});
