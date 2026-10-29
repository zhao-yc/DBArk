import { expect, it } from 'vitest';
import { isApplicationMenuDocument } from '../../src/main/applicationMenu';

it('原生菜单识别开发脚本省略根斜杠的同一文档，拒绝其它页面', () => {
  expect(isApplicationMenuDocument('http://127.0.0.1:5186/', 'http://127.0.0.1:5186')).toBe(true);
  for (const url of ['http://127.0.0.1:5187/', 'http://localhost:5186/', 'http://127.0.0.1:5186/other', 'http://127.0.0.1:5186/?other=1', 'invalid']) expect(isApplicationMenuDocument(url, 'http://127.0.0.1:5186')).toBe(false);
  expect(isApplicationMenuDocument('file:///D:/DBArk/dist/renderer/index.html', 'file:///D:/DBArk/dist/renderer/index.html')).toBe(true);
  expect(isApplicationMenuDocument('file:///D:/other/index.html', 'file:///D:/DBArk/dist/renderer/index.html')).toBe(false);
});
