import { describe, expect, it } from 'vitest';
import { verifySelectedResultsCsv } from '../helpers/selectedResultsExportCsv';

// 人工编写CSV字节；禁止调用产品导出、列映射或数据读取器来生成期望。
const header = 'id,repeated,repeated [3],bytes\r\n';
const first = '1,18446744073709551615,\\N,base64:AP8=\r\n';
const third = '3,0.12345678901234567890,"",\\N\r\n';
const csv = header + first + third;

describe('勾选行CSV独立字节期待', () => {
  it.each(['', '\ufeff'])('独立解析两条准确记录，允许UTF-8 BOM %j', bom => {
    expect(() => verifySelectedResultsCsv(Buffer.from(bom + csv, 'utf8'))).not.toThrow();
  });
  it.each([
    ['行序颠倒', header + third + first],
    ['混入未选行', header + first + '2,不选,中间,base64:\r\n' + third],
    ['重名标题误按重名次数编号', csv.replace('repeated [3]', 'repeated [2]')],
    ['大整数字符串被舍入', csv.replace('18446744073709551615', '18446744073709552000')],
    ['精确小数字符串被舍入', csv.replace('0.12345678901234567890', '0.12345678901234568')],
    ['NULL被空串替代', csv.replace('51615,\\N,', '51615,"",')],
    ['空串被NULL替代', csv.replace('67890,"",', '67890,\\N,')],
    ['二进制字节被改变', csv.replace('base64:AP8=', 'base64:AP4=')],
    ['NULL二进制被空二进制替代', csv.replace('67890,"",\\N', '67890,"",base64:')],
  ])('%s必须拒绝', (_name, bytes) => {
    expect(() => verifySelectedResultsCsv(Buffer.from(bytes, 'utf8'))).toThrow();
  });
});
