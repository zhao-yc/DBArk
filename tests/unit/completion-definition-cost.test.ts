import { afterEach, expect, it, vi } from 'vitest';
import { MySQL } from 'dt-sql-parser/dist/parser/mysql/index';
import { analyzeCompletionDefinition } from '../../src/shared/completionDefinitionAnalysis';
import { analyzeCompletion } from '../../src/shared/completionAnalysis';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';
import { analyzeMysqlLocalRename } from '../../src/shared/mysqlLocalRename';

afterEach(() => vi.restoreAllMocks());

/** 使用真实解析器；候选入口禁止被调用，但完整AST与validate不能由测试替身代办。 */
it('F12、引用和重命名不计算补全候选，仍逐次完整验证语法并准确绑定声明', () => {
  const suggestions = vi.spyOn(MySQL.prototype, 'getSuggestionAtCaretPosition').mockImplementation(() => { throw Error('声明定位不能计算补全候选'); });
  const validation = vi.spyOn(MySQL.prototype, 'validate');
  const source = 'SELECT s.id FROM subject s WHERE s.id>0', offset = source.indexOf('s.id') + 1, declaration = source.indexOf('s WHERE');
  expect(analyzeCompletionDefinition(source, offset)).toMatchObject({ status: 'ready', definition: { start: declaration, end: declaration + 1 }, syntax: [], relations: [], localRelations: [] });
  expect(analyzeLocalReferences(source, offset)).toMatchObject({ status: 'ready', declaration: { start: declaration, end: declaration + 1 }, references: [{ start: 7, end: 8 }, { start: source.lastIndexOf('s.id'), end: source.lastIndexOf('s.id') + 1 }] });
  expect(analyzeMysqlLocalRename(source, offset, {}, {}, 'renamed')).toMatchObject({ status: 'ready', kind: 'alias', edits: [{ start: 7, end: 8, text: '`renamed`' }, { start: declaration, end: declaration + 1, text: '`renamed`' }, { start: source.lastIndexOf('s.id'), end: source.lastIndexOf('s.id') + 1, text: '`renamed`' }] });
  const validations = validation.mock.calls.length;
  expect(validations).toBeGreaterThanOrEqual(3);
  expect(analyzeCompletionDefinition(source + ' AND (', offset).status).toBe('blocked');
  expect(validation.mock.calls.length).toBeGreaterThan(validations);
  expect(suggestions).not.toHaveBeenCalled();
});

/** 普通建议仍走原预测器，不能把这项优化扩到真正需要候选的补全入口。 */
it('普通补全仍生成原字段候选与语法种类', () => {
  const suggestions = vi.spyOn(MySQL.prototype, 'getSuggestionAtCaretPosition');
  const source = 'SELECT s. FROM subject s', result = analyzeCompletion(source, source.indexOf('.') + 1);
  expect(result).toMatchObject({ status: 'ready', syntax: ['function', 'column'], relations: [expect.objectContaining({ name: 's', table: 'subject' })] });
  expect(suggestions).toHaveBeenCalledOnce();
});
