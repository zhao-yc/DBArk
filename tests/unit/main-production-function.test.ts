import { expect, it } from 'vitest';
import { extractMainProductionFunction } from './main-production-function';

it('唯一真实函数完整保留且不把相邻菜单、启动或退出接线带入VM', () => {
  const dispatch = 'async function dispatch(command: string) { return command; }';
  const source = "const state = {};\n" + dispatch + "\n/** 任意新菜单注释 */\nfunction createMenu() { return state; }\napp.on('before-quit', () => { applicationMenu.invalidate(); });";
  expect(extractMainProductionFunction(source, 'dispatch')).toBe(dispatch);
});

it.each([
  '',
  'function other() { return 1; }',
  'function dispatch() {}',
  'declare function dispatch(): void;',
  'function outer() { function dispatch() { return 1; } }',
  'function dispatch() { return 1; } function dispatch() { return 2; }'
])('缺失、空体、嵌套或重复入口必须在执行前失败：%s', source => {
  expect(() => extractMainProductionFunction(source, 'dispatch')).toThrow('唯一且完整的非空顶层函数');
});
