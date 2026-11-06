import { postgresTableLimits } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { draftHistoryLimits } from './draftHistory';

export type { PostgresDraftEntry } from '../shared/postgresTableDraft';
export type PostgresDraftGroup = 'fill' | 'delete' | 'edit' | 'duplicate' | 'template';
interface HistoryState {
  entries: PostgresDraftEntry[];
  tokens: Set<string>;
  bytes: number;
  group?: PostgresDraftGroup;
}

/** 记录不可变草稿及原页令牌。保守计入所有引用的字段值，不克隆或解码值。 */
function historyState(entries: PostgresDraftEntry[], group?: PostgresDraftGroup): HistoryState {
  let bytes = 64;
  const tokens = new Set<string>();
  for (const entry of entries) {
    tokens.add(entry.change.pageToken);
    bytes += 192 + 2 * (entry.change.pageToken.length + (entry.rowKey?.length ?? 0));
    if (entry.change.kind !== 'delete') for (const field of entry.change.fields) {
      bytes += 96 + 2 * (field.column.length + ('value' in field.value ? field.value.value.length : 0));
    }
  }
  return { entries, tokens, bytes, group };
}

/** 保存有限的原页草稿版本，翻页后只保留仍能连续撤销或重做的版本。 */
export class PostgresDraftHistory {
  private states = [historyState([])];
  private index = 0;

  get status() {
    return { undo: this.index, redo: this.states.length - this.index - 1,
      undoGroup: this.index > 0 ? this.states[this.index].group : undefined };
  }

  /** 刷新、筛选、提交和连接变更会更换原页能力，当前草稿仍由调用方掌管。 */
  reset(entries: PostgresDraftEntry[]) {
    this.states = [historyState(entries)];
    this.index = 0;
  }

  /** 发布一次本地草稿就是一步，新编辑从当前版本分支并释放旧重做路径。 */
  record(entries: PostgresDraftEntry[], group?: PostgresDraftGroup) {
    this.states = [...this.states.slice(0, this.index + 1), historyState(entries, group)];
    let bytes = this.states.reduce((total, state) => total + state.bytes, 0);
    while (this.states.length > 1 && (this.states.length > draftHistoryLimits.operations + 1 || bytes > draftHistoryLimits.bytes)) {
      bytes -= this.states.shift()!.bytes;
    }
    this.index = this.states.length - 1;
  }

  /** 恢复准确原页而不复用旧数组身份，迟到的编辑窗口不能借撤销重做重新认领。 */
  move(direction: 'undo' | 'redo'): PostgresDraftEntry[] | undefined {
    const next = this.index + (direction === 'undo' ? -1 : 1), state = this.states[next];
    if (!state) return undefined;
    this.index = next;
    return [...state.entries];
  }

  /** 优先保留当前草稿，再按邻近程度尝试保留两侧可达的版本。 */
  pins() {
    const current = this.states[this.index].tokens;
    let retained = new Set(current), undo = this.index - 1, redo = this.index + 1;
    const add = (index: number) => {
      const next = new Set([...retained, ...this.states[index].tokens]);
      if (next.size > postgresTableLimits.draftPages) return false;
      retained = next;
      return true;
    };
    while (undo >= 0 || redo < this.states.length) {
      if (undo >= 0) undo = add(undo) ? undo - 1 : -1;
      if (redo < this.states.length) redo = add(redo) ? redo + 1 : this.states.length;
    }
    return { retainPageTokens: [...current], retainHistoryPageTokens: [...retained].filter(token => !current.has(token)) };
  }

  /** 只采纳引擎确认仍有效的快照，断点之后的旧历史不能跨过失效状态。 */
  retain(tokens: ReadonlySet<string>) {
    const valid = (index: number) => [...this.states[index].tokens].every(token => tokens.has(token));
    let first = this.index, last = this.index;
    while (first > 0 && valid(first - 1)) first--;
    while (last + 1 < this.states.length && valid(last + 1)) last++;
    this.states = this.states.slice(first, last + 1);
    this.index -= first;
  }
}
