import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** 只接受已审查的上游版本和三处Promise修复字节；升级依赖时必须重新核对。 */
export const monacoWordHighlighterPatch = {
  version: '0.55.1',
  file: 'esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js',
  originalSha256: '507b02c2395b05aedcc3d512c6f7653bcf0e8205d4bc7af92398eafd61b31c89',
  patchedSha256: 'b20417e61b8e71253ce6434e3568ec8c4d5d40ecdf945d419fda91d12a0e9420',
  patchSha256: 'b9abd5505107b0934040c6ac1a3813d8b2af80e7f4ca849a496871a21ac5d095',
} as const;

/** 从当前工程解析依赖，不写node_modules；未安装正式补丁时拒绝开发/生产构建。 */
export function verifyMonacoWordHighlighterPatch(root: string): { version: string; sha256: string } {
  const expected = monacoWordHighlighterPatch;
  const require = createRequire(join(root, 'package.json'));
  const manifestPath = require.resolve('monaco-editor/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  if (project.dependencies?.['monaco-editor'] !== expected.version || manifest.version !== expected.version || manifest.license !== 'MIT') throw Error('Monaco版本或MIT归属已变化，请重新审查词语高亮补丁');
  if (hash(readFileSync(join(root, 'patches', `monaco-editor@${expected.version}.patch`))) !== expected.patchSha256) throw Error('Monaco词语高亮补丁字节已变化，不能沿用旧锁文件或验证结果');
  const sha256 = hash(readFileSync(join(dirname(manifestPath), expected.file)));
  if (sha256 !== expected.patchedSha256) throw Error('Monaco词语高亮正式补丁未生效或字节不符，请按冻结锁文件安装依赖；不会回退未修复代码');
  return { version: manifest.version, sha256 };
}

/** Vite开发与构建共用同一门，避免预打包或生产构建绕过补丁安装检查。 */
export function monacoWordHighlighterGuard(): Plugin {
  return { name: 'dbark-monaco-word-highlighter-patch', enforce: 'pre', configResolved(config) { verifyMonacoWordHighlighterPatch(config.root); } };
}
