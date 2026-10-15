import {describe,it,expect} from 'vitest';
import {validateDatabaseSearchPattern,databaseSearchPatternLimits} from '../../src/shared/databaseSearchPattern';
import {databaseSearchMatch} from '../../src/engine/databaseSearchMatch';
const pattern=(mode:'contains'|'whole'|'prefix'|'regexp',text:string,caseSensitive=false)=>({mode,text,caseSensitive});

describe('全库搜索匹配参数边界',()=>{
  it('完整值接纳空字符串，保留空格、NUL、Unicode及精确数字原文',()=>{for(const text of['','  原文\0🚀  ','9007199254740993','12345678901234567890.123456789012'])expect(validateDatabaseSearchPattern(pattern('whole',text)).text).toBe(text);});
  it.each(['contains','prefix','regexp'] as const)('%s不把空输入自动变成全库匹配',mode=>{expect(()=>validateDatabaseSearchPattern(pattern(mode,''))).toThrow('搜索文字');});
  it('拒绝未知方式、隐式布尔转换和注入的SQL字段',()=>{for(const value of[{mode:'sql',text:'x',caseSensitive:false},{mode:'whole',text:'x',caseSensitive:'false'},{...pattern('whole','x'),sql:'DROP TABLE t'},JSON.parse('{"mode":"whole","text":"x","caseSensitive":false,"__proto__":"x"}')])expect(()=>validateDatabaseSearchPattern(value)).toThrow();});
  it('分别界定UTF16和UTF8预算，不截断搜索目标',()=>{expect(validateDatabaseSearchPattern(pattern('whole','a'.repeat(databaseSearchPatternLimits.units))).text).toHaveLength(4096);expect(()=>validateDatabaseSearchPattern(pattern('whole','a'.repeat(4097)))).toThrow();expect(validateDatabaseSearchPattern(pattern('whole','字'.repeat(2730))).text).toHaveLength(2730);expect(()=>validateDatabaseSearchPattern(pattern('whole','字'.repeat(2731)))).toThrow('8KiB');});
  it.each(['\ud800','\udc00','x\ud800y','\ud800\ud800'])('无效Unicode不得变成另一个可搜索值',text=>{expect(()=>validateDatabaseSearchPattern(pattern('whole',text))).toThrow('代理项');});
});

describe('全库搜索参数化SQL',()=>{
  it('包含与前缀对通配符和转义符按字面处理，反斜线不参与SQL字符串编码',()=>{expect(databaseSearchMatch({column:'value'},pattern('contains','a!%_\\')).params).toEqual(['%a!!!%!_\\%']);expect(databaseSearchMatch({column:'value'},pattern('prefix','a!%_\\')).params).toEqual(['a!!!%!_\\%']);expect(databaseSearchMatch({column:'value'},pattern('prefix','a')).sql).toContain("ESCAPE '!'");});
  it('列名中的点号和反引号不会被拆成SQL语法',()=>{const result=databaseSearchMatch({column:'a`.b',qualifier:'scope'},pattern('whole','needle'));expect(result.sql).toContain('CONVERT(`scope`.`a``.b` USING utf8mb4)');expect(result.params).toEqual(['needle']);});
  it('搜索值不插入SQL，普通完整值与正则均保留原文',()=>{const value="x' OR 1=1 -- \\_";for(const mode of['whole','regexp'] as const){const result=databaseSearchMatch({column:'value'},pattern(mode,value));expect(result.sql).not.toContain(value);expect(result.params).toEqual([value]);}});
  it('完整值明确保留尾空格，忽略大小写由服务器在UTF8文本上转换',()=>{const insensitive=databaseSearchMatch({column:'value'},pattern('whole','A ')),sensitive=databaseSearchMatch({column:'value'},pattern('whole','A ',true));expect(insensitive.sql).toContain('CAST(LOWER(CONVERT(');expect(insensitive.sql).toContain(' AS BINARY)');expect(sensitive.sql).not.toContain('LOWER(');expect(insensitive.params).toEqual(['A ']);});
  it('正则不调用JS解析或LOWER改写语法，避免MySQL8二进制参数错误',()=>{const result=databaseSearchMatch({column:'value'},pattern('regexp','(?-i)\\p{Han}+'));expect(result.params).toEqual(['(?-i)\\p{Han}+']);expect(result.sql).toContain(' COLLATE utf8mb4_unicode_ci REGEXP ');expect(result.sql).not.toContain(' AS BINARY');expect(result.sql).not.toContain('LOWER(');expect(databaseSearchMatch({column:'value'},pattern('regexp','[')).params).toEqual(['[']);});
  it('HEX文本按显式投影搜索，不能由调用者注入任意表达式',()=>{expect(databaseSearchMatch({column:'bytes',representation:'hex'},pattern('whole','00FF')).sql).toContain('CONVERT(HEX(`bytes`) USING utf8mb4)');for(const column of[{column:'a',expression:'NOW()'},{column:'',representation:'text'},{column:'a',qualifier:'x\0y'},{column:'a',representation:'raw'}])expect(()=>databaseSearchMatch(column as never,pattern('whole','x'))).toThrow();});
});
