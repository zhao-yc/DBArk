import { expect, it } from 'vitest';
import { MemoryDocument } from '../fixtures/memory-dom';

const sql = 'CREATE TABLE `t` (`id` int NOT NULL) ENGINE=InnoDB';
/** 只核HTML textarea值合同，不加载React、浏览器、布局或原生输入。 */
function textarea() { const document = new MemoryDocument(); return { document, node: document.createElement('textarea') }; }

it('textarea默认值同时是子文本，未编辑的value须立即跟随，无须二次渲染', () => {
  const { node } = textarea(); node.defaultValue = sql;
  expect(node.defaultValue).toBe(sql); expect(node.textContent).toBe(sql); expect(node.value).toBe(sql);
});
it('未编辑textarea的子文本替换及文本节点变更同步默认值和当前值', () => {
  const { document, node } = textarea(); node.textContent = sql; expect(node.defaultValue).toBe(sql); expect(node.value).toBe(sql);
  node.textContent = ''; const child = document.createTextNode('原文'); node.appendChild(child); expect(node.defaultValue).toBe('原文'); expect(node.value).toBe('原文');
  child.nodeValue = '新文'; expect(node.defaultValue).toBe('新文'); expect(node.value).toBe('新文'); node.removeChild(child); expect(node.defaultValue).toBe(''); expect(node.value).toBe('');
});
it('默认值只取直接文本子节点，不能把嵌套标签正文当textarea默认值', () => {
  const { document, node } = textarea(); node.appendChild(document.createTextNode('直接文本'));
  const nested = document.createElement('span'); nested.textContent = '嵌套正文'; node.appendChild(nested);
  expect(node.textContent).toBe('直接文本嵌套正文'); expect(node.defaultValue).toBe('直接文本'); expect(node.value).toBe('直接文本');
});
it('写value后形成dirty标志，后续默认值/子文本变更不覆盖当前编辑值', () => {
  const { node } = textarea(); node.defaultValue = sql; node.value = '编辑内容';
  expect(node.textContent).toBe(sql); node.defaultValue = '新默认'; expect(node.textContent).toBe('新默认'); expect(node.value).toBe('编辑内容');
  node.textContent = ''; expect(node.defaultValue).toBe(''); expect(node.value).toBe('编辑内容');
});
it('即使value写入相同空值也会变dirty，不能再被默认值覆盖', () => {
  const { node } = textarea(); node.value = ''; node.defaultValue = sql; expect(node.textContent).toBe(sql); expect(node.value).toBe('');
});
it('textarea API值按LF读回，默认子文本保留原CRLF/CR字节语义', () => {
  const { node } = textarea(); node.defaultValue = '甲\r\n乙\r丙\n'; expect(node.textContent).toBe('甲\r\n乙\r丙\n'); expect(node.value).toBe('甲\n乙\n丙\n');
  node.value = '丁\r\n戊'; expect(node.value).toBe('丁\n戊'); expect(node.defaultValue).toBe('甲\r\n乙\r丙\n');
});
it('其它内存节点保持原独立字段合同，不顺带补input或一般元素语义', () => {
  const document = new MemoryDocument(); for (const name of ['input', 'div']) { const node = document.createElement(name); node.defaultValue = sql; expect(node.value).toBe(''); expect(node.textContent).toBe(''); }
});
