import { describe, expect, it } from 'vitest';
import { postgresTableFieldValueSchema } from '../../src/shared/postgresTable';
import { postgresBinaryEditBytes, postgresBinaryInputHex } from '../../src/renderer/postgresBinaryInput';

describe('PostgreSQL BYTEA 文件输入', () => {
  it('将查看器的 Hex 格式交给既有 BYTEA 草稿，保留空文件为零字节', () => {
    expect(postgresBinaryInputHex('0X00 ff\n10')).toBe('00ff10');
    expect(postgresTableFieldValueSchema.parse({ mode: 'binary', value: postgresBinaryInputHex('0x') })).toEqual({ mode: 'binary', value: '' });
    expect(postgresBinaryInputHex('0xf')).toBe('f');
    expect(postgresTableFieldValueSchema.safeParse({ mode: 'binary', value: 'f' }).success).toBe(false);
  });

  it('完整接受 32 KiB 并拒绝超出一个字节的候选', () => {
    const hex = 'ff'.repeat(postgresBinaryEditBytes);
    expect(postgresBinaryInputHex('0x' + hex)).toBe(hex);
    expect(() => postgresBinaryInputHex('0x' + hex + '00')).toThrow('32 KiB');
  });
});
