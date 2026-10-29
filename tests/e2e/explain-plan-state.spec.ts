import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { test, expect, desktop, dataDir } from './desktop-fixture';

// 原生GUI有独占安排；默认在桌面夹具启动前跳过，仅由统筹另行启用受控组件验收。
test.skip(process.env.DBARK_PLAN_STATE_COMPONENT !== '1', '需统筹显式启用计划状态组件验收，默认不启动GUI');
test.use({ trace: 'off' });

/** 使用QueryTab真实结果表达式，避免组件夹具另写一份正确条件掩盖产品回归。 */
async function resultBody() {
  const source = await readFile('src/renderer/components/QueryTab.tsx', 'utf8'), file = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className' && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'result-body')) body = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file); if (!body) throw Error('未找到QueryTab真实结果表达式'); return body;
}

test('受控组件：保存另存CAS繁忙保留计划模式、选中和展开，新查询清理旧计划', async ({}, info) => {
  const body = await resultBody(), bundle = join(dataDir, 'explain-state.js'), html = join(dataDir, 'explain-state.html');
  // 繁忙/新执行信号由夹具控制，计划查看器与结果表达式均是真实代码，不模拟数据库验收。
  const entry = `
import {useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import{ExplainPlanView}from'./src/renderer/components/ExplainPlanView';import{ResultsGrid}from'./src/renderer/components/ResultsGrid';
import{Empty}from'./src/renderer/components/ui';import{zh,formatText}from'./src/renderer/locales/zh-CN';import{parseExplainPlan}from'./src/shared/explain';import'./src/renderer/styles.css';
const raw=JSON.stringify({query_block:{select_id:1,nested_loop:[{table:{table_name:'left_table',access_type:'ALL',rows_examined_per_scan:10}},{table:{table_name:'right_table',access_type:'ref',rows_examined_per_scan:2}}]}});
const initial={results:[{columns:[{key:'c0',name:'EXPLAIN',type:'JSON'}],rows:[{c0:raw}],statement:'EXPLAIN SELECT ...',elapsedMs:1,truncated:false}],elapsedMs:1,explain:parseExplainPlan(raw,'mysql','8.4 静态样本')};
function App(){const[busy,setBusy]=useState(false),[outcome,setOutcome]=useState(initial),task=useRef('original-plan');const pin=null,resultIndex=0,sessionId='controlled-session',result=outcome?.results[0],explainSource={current:'SELECT ...'};
const runQuery=()=>{throw Error('受控组件禁止发送SQL')};
return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><div role="group" aria-label="受控状态">{['保存','另存','CAS失败'].map(action=><button key={action} onClick={()=>setBusy(true)}>{action}开始</button>)}<button onClick={()=>setBusy(false)}>结束繁忙</button><button onClick={()=>{task.current='new-query';setOutcome(null);setBusy(true)}}>新查询开始</button><button onClick={()=>{setOutcome({results:[{columns:[{key:'c0',name:'value',type:'LONG'}],rows:[{c0:'2'}],elapsedMs:1,truncated:false,statement:'SELECT 2'}],elapsedMs:1});setBusy(false)}}>新查询结束</button></div><div style={{flex:1,minHeight:0}}>${body}</div></div>}
createRoot(document.getElementById('root')).render(<App/>);`;
  await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd() }, outfile: bundle, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  await writeFile(html, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; script-src \'self\';"><link rel="stylesheet" href="explain-state.css"><body><div id="root"></div><script src="explain-state.js"></script></body></html>');
  const opening = desktop.waitForEvent('window');
  const id = await desktop.evaluate(async ({ BrowserWindow }, path) => { const window = new BrowserWindow({ width: 1024, height: 680, show: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }); await window.loadFile(path); window.focus(); return window.id; }, html);
  const view = await opening, errors: string[] = []; view.on('pageerror', error => errors.push(error.message));
  try {
    const block = view.getByRole('treeitem').filter({ hasText: '查询块 · 1' }); await block.click(); await block.press('ArrowLeft');
    await expect(block).toHaveAttribute('aria-expanded', 'false'); await expect(block).toHaveAttribute('aria-selected', 'true');
    await (await navigationMenuItem(view, { name: '保存开始', exact: true })).click(); await expect(block).toHaveAttribute('aria-expanded', 'false'); await expect(block).toHaveAttribute('aria-selected', 'true');
    await expect((await navigationMenuItem(view, { name: '获取文本计划', exact: true }))).toBeDisabled(); await (await navigationMenuItem(view, { name: '结束繁忙', exact: true })).click();
    await expect(block).toHaveAttribute('aria-expanded', 'false'); await (await navigationMenuItem(view, { name: '原始输出', exact: true })).click();
    await (await navigationMenuItem(view, { name: '另存开始', exact: true })).click(); await expect((await navigationMenuItem(view, { name: '原始输出', exact: true }))).toHaveAttribute('aria-pressed', 'true');
    await (await navigationMenuItem(view, { name: '结束繁忙', exact: true })).click(); await expect((await navigationMenuItem(view, { name: '原始输出', exact: true }))).toHaveAttribute('aria-pressed', 'true');
    await (await navigationMenuItem(view, { name: '树形计划', exact: true })).click(); await (await navigationMenuItem(view, { name: 'CAS失败开始', exact: true })).click();
    await expect(block).toHaveAttribute('aria-expanded', 'false'); await (await navigationMenuItem(view, { name: '结束繁忙', exact: true })).click(); await expect(block).toHaveAttribute('aria-selected', 'true');
    await view.screenshot({ path: info.outputPath('plan-state-retained.png') });
    await (await navigationMenuItem(view, { name: '新查询开始', exact: true })).click(); await expect(view.getByRole('tree')).toHaveCount(0);
    await (await navigationMenuItem(view, { name: '新查询结束', exact: true })).click(); await expect(view.getByRole('grid')).toBeVisible(); await expect(view.getByRole('tree')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), id); }
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
