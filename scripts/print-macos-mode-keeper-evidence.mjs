import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDesktopKeeperContext } from './macos-installed-cleanup-lease.mjs';

/** 只投影生产者已经写出的模式帧，不枚举显示器、读取应用或改变失败现场。 */
export function summarizeKeeperJournal(bytes) {
  assert.ok(bytes.length <= 8 * 1024 * 1024, '原日志超过生产者预算');
  const text = bytes.toString('utf8');
  assert.ok(Buffer.from(text).equals(bytes) && (!text || text.endsWith('\n')), '原日志编码或最后一帧未闭合');
  const frames = text ? text.slice(0, -1).split('\n').map(line => {
    assert.ok(Buffer.byteLength(line) <= 2 * 1024 * 1024, '原单帧超过生产者预算');
    const value = JSON.parse(line);
    return { type: value.type, seq: value.seq, ...(value.reason ? { reason: String(value.reason).slice(0, 512) } : {}),
      ...(value.snapshot ? { displays: value.snapshot.displays.map(display => ({
        displayID: display.displayID, framePoints: display.framePoints, visibleFramePoints: display.visibleFramePoints,
        currentMode: display.currentMode, availableModeCount: display.availableModeCount,
        backingScaleFactor: display.backingScaleFactor, mirrored: display.mirrored,
      })) } : {}) };
  }) : [];
  const selected = frames.length <= 8 ? frames : [...frames.slice(0, 4), ...frames.slice(-4)];
  return { frameCount: frames.length, omittedMiddleFrames: frames.length - selected.length, frames: selected };
}

/** 仅固定三个生产者文件；文件变化或链接不作稳定证据，绝不读取资料目录或SDK。 */
function printEvidence() {
  const desktop = isDesktopKeeperContext(process.env), phase = desktop ? process.argv[2] : undefined;
  assert.equal(process.argv.length, desktop ? 3 : 2);
  if (desktop) assert.ok(['source', 'installed'].includes(phase));
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.ok(desktop || process.env.GITHUB_REF === 'refs/heads/codex/macos-mode-keeper-20261019' ||
    process.env.GITHUB_REF === 'refs/heads/codex/v028-serial-closeout-20261019' && process.env.GITHUB_JOB === 'arm64-installed');
  const directory = fileURLToPath(new URL(`../.cache/macos-mode-keeper/${desktop ? phase + '/' : ''}`, import.meta.url));
  for (const name of ['plan.json', 'keeper.jsonl', 'receipt.json']) {
    const path = join(directory, name), file = desktop ? `${phase}/${name}` : name; let descriptor;
    try {
      const before = lstatSync(path, { bigint: true });
      assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 8n * 1024n * 1024n, '生产者文件身份或预算不符');
      descriptor = openSync(path, 'r'); const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor, { bigint: true }), named = lstatSync(path, { bigint: true });
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
        assert.equal(after[key], before[key], '原句柄读取中发生变化'); assert.equal(named[key], before[key], '原名称读取中发生变化');
      }
      assert.equal(BigInt(bytes.length), before.size);
      let value;
      if (name === 'keeper.jsonl') value = summarizeKeeperJournal(bytes);
      else {
        assert.ok(bytes.length <= 64 * 1024, '原计划或收据超过日志输出预算');
        const parsed = JSON.parse(bytes.toString('utf8'));
        value = name === 'plan.json' ? { plan: parsed.plan, context: parsed.inventory?.context } : parsed;
      }
      console.log('DBARK_MODE_EVIDENCE:' + JSON.stringify({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), value }));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log('DBARK_MODE_EVIDENCE:' + JSON.stringify({ file, missing: true, evidenceProven: false }));
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) printEvidence();
