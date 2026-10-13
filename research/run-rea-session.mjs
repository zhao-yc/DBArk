/** 在独立 REA MCP 会话中执行只读分析；结果仅保存在忽略的 private 目录。 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, '.tools/rea/package.json'));
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')));
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error('请提供目标文件的绝对路径');
const output = path.join(root, 'research/private', `rea-${Date.now()}`);
await mkdir(output, { recursive: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, '.tools/rea/node_modules/rea-agents/scripts/rea.mjs'), 'mcp'],
  env: { ...process.env, REA_ANALYSIS_PROVIDER: 'ghidra', REA_GHIDRA_STARTUP_TIMEOUT_MS: '900000' },
  cwd: root,
  stderr: 'pipe'
});
const client = new Client({ name: 'dbark-research', version: '0.1.0' });
transport.stderr?.on('data', (data) => { void appendFile(path.join(output, 'server.stderr.txt'), data); });
let count = 0;

/** 保存每次请求和完整应答，控制台只输出状态，避免泄露目标文本。 */
async function call(name, args) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args }, {
    timeout: 960000,
    onprogress: () => {}
  });
  await writeFile(path.join(output, `${String(++count).padStart(2, '0')}-${name}.json`),
    JSON.stringify({ request: { name, arguments: args }, elapsed_ms: Date.now() - started, result }, null, 2));
  console.log(JSON.stringify({ operation: name, ok: !result.isError, elapsed_ms: Date.now() - started }));
  return result;
}

try {
  await client.connect(transport);
  const catalog = await client.listTools();
  await writeFile(path.join(output, 'tool-catalog.json'), JSON.stringify(catalog, null, 2));
  console.log(JSON.stringify({ output, tool_count: catalog.tools.length }));
  if (!process.argv.includes('--catalog-only')) {
    const opened = await call('open_binary', { path: target, provider_id: 'ghidra' });
    if (opened.isError) throw new Error('目标打开失败，请检查私有证据');
    const overview = await call('binary_overview', {});
    if (overview.isError) throw new Error('引擎分析失败，请检查私有证据');
    await call('search_procedures', { pattern: 'mysql_(real_connect|real_query|query|kill|commit|rollback)', mode: 'regex' });
    await call('search_strings', { pattern: 'KILL QUERY|START TRANSACTION|mysql_real_connect|mysql_real_query|Apply Changes|Run Selected', mode: 'regex' });
    // 已知公开数据库客户端函数名作为检索入口；不存在时保留明确失败证据。
    for (const procedure of ['mysql_real_connect', 'mysql_real_query', 'mysql_kill', 'mysql_commit', 'mysql_rollback']) {
      await call('procedure_pseudo_code', { procedure });
      await call('procedure_references', { procedure, direction: 'incoming' });
    }
    await call('export_evidence_bundle', { path: path.join(output, 'evidence-bundle.json') });
  }
} finally {
  try { await call('close_binary', {}); } finally { await client.close(); }
}
