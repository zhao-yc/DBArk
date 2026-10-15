import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { ElectronApplication } from '@playwright/test';
import { c02Failure } from '../integration/helpers/c02-mtls-policy';

// Playwright 在本 CommonJS 工程中加载测试，按明确工作目录解析 wasm，不能依赖 import.meta。
const c02Require = createRequire(join(process.cwd(), 'package.json'));
export interface C02StorageFacts {
  profileFound: boolean; profileHasNoSecrets: boolean; diskHasNoPlaintext: boolean;
  passwordSlots: number; tlsSlots: number; otherSlots: number;
  nativeAvailable: boolean; passwordDecrypts: boolean; tlsDecrypts: boolean;
}

/** 实读本例 SQLite，秘密只在主进程与本控件夹具内比较，报告只含布尔值/数量。 */
export async function c02StorageFacts(app: ElectronApplication, directory: string, id: string, password: string, passphrase: string): Promise<C02StorageFacts> {
  try {
    const bytes = await readFile(join(directory, 'dbark.sqlite'));
    const SQL = await initSqlJs({ locateFile: () => c02Require.resolve('sql.js/dist/sql-wasm.wasm') });
    const db = new SQL.Database(bytes);
    let raw: Record<string, unknown> | undefined;
    const slots: { name: string; value: string }[] = [];
    try {
      const profile = db.prepare('SELECT data FROM connections WHERE id=?');
      try { profile.bind([id]); if (profile.step()) raw = JSON.parse(String(profile.get()[0])) as Record<string, unknown>; } finally { profile.free(); }
      const secrets = db.prepare('SELECT name,value FROM secrets WHERE connection_id=?');
      try { secrets.bind([id]); while (secrets.step()) { const row = secrets.get(); slots.push({ name: String(row[0]), value: String(row[1]) }); } } finally { secrets.free(); }
    } finally { db.close(); }
    const tls = raw?.tls as Record<string, unknown> | undefined;
    const publicOnly = !!raw && !Object.hasOwn(raw, 'password') && !Object.hasOwn(raw, 'hasPassword') && !!tls && !Object.hasOwn(tls, 'passphrase') && !Object.hasOwn(tls, 'hasPassphrase');
    // 真实 safeStorage 解密结果不跨出主进程，禁止将明文返回测试框架作为 expect 的实际值。
    const decrypted = await app.evaluate(({ safeStorage }, input) => {
      const available = safeStorage.isEncryptionAvailable();
      const matches = (name: string, expected: string): boolean => {
        const values = input.slots.filter(slot => slot.name === name);
        if (!available || values.length !== 1) return false;
        try { return safeStorage.decryptString(Buffer.from(values[0].value, 'base64')) === expected; } catch { return false; }
      };
      return { nativeAvailable: available, passwordDecrypts: matches('password', input.password), tlsDecrypts: matches('tlsPassphrase', input.passphrase) };
    }, { slots, password, passphrase });
    return { profileFound: !!raw, profileHasNoSecrets: publicOnly, diskHasNoPlaintext: [password, passphrase].every(secret => !bytes.includes(Buffer.from(secret, 'utf8')) && !bytes.includes(Buffer.from(secret, 'utf16le'))),
      passwordSlots: slots.filter(slot => slot.name === 'password').length, tlsSlots: slots.filter(slot => slot.name === 'tlsPassphrase').length, otherSlots: slots.filter(slot => !['password', 'tlsPassphrase'].includes(slot.name)).length, ...decrypted };
  } catch (error) { throw c02Failure('C02 实际 SQLite 与原生安全存储检查失败', error); }
}
