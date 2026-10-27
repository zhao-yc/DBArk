import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Packet = require(join(dirname(require.resolve('mysql2')), 'lib/packets/packet.js')) as new (id: number, buffer: Buffer, start: number, end: number) => { eofWarningCount(): number; eofStatusFlags(): number };

/** 直接读取已安装驱动的完整二进制EOF，警告计数和状态位不能互相覆盖。 */
function readWarnings(count: number, status = 33283) {
  const buffer = Buffer.from([5, 0, 0, 1, 0xfe, count & 255, count >>> 8, status & 255, status >>> 8]);
  const packet = new Packet(1, buffer, 0, buffer.length);
  return { count: packet.eofWarningCount(), status: packet.eofStatusFlags() };
}

describe('mysql2真实EOF的无符号警告数', () => {
  it.each([0, 1, 255, 256, 32767, 32768, 33283, 65534, 65535])('警告数%d不成为负数且保持独立状态', count => {
    expect(readWarnings(count)).toEqual({ count, status: 33283 });
  });
  it.each([0, 1, 514, 32768, 65535])('状态%d不改变最大警告数', status => {
    expect(readWarnings(65535, status)).toEqual({ count: 65535, status });
  });
});
