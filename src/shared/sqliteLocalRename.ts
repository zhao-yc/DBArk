import { analyzeSqliteCompletion, sqliteReferenceContext } from './sqliteCompletionAnalysis';
import { analyzeSqliteLocalReferences } from './sqliteLocalReferences';
import { planLocalRename } from './localRename';

/** SQLite重命名只用自己的语句、引号和绑定证明，不借用MySQL模式或大小写规则。 */
export function analyzeSqliteLocalRename(source: string, offset: number, newName?: string) {
  const references = analyzeSqliteLocalReferences(source, offset);
  return planLocalRename(sqliteReferenceContext(source, offset), references, 'sqlite', reference => {
    let kind: 'alias' | 'cte' | 'physical' | undefined;
    const proof = analyzeSqliteCompletion(source, reference.end, 'definition', value => { kind = value; });
    return proof.status === 'ready' && references.status === 'ready' && proof.definition?.start === references.declaration.start ? kind : undefined;
  }, newName);
}
