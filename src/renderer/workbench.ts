import { create } from 'zustand';
import { emptyWorkbench, targetKey, workbenchDocumentSchema, type WorkbenchDocument, type WorkbenchSnapshot, type WorkbenchTarget } from '../shared/workbench';
import { errorMessage, invoke, uid } from './lib';
import { useWorkspace } from './store';
import { workbenchZh as t } from './locales/workbench.zh-CN';

interface WorkbenchState {
  snapshot: WorkbenchSnapshot; ready: boolean; busy: boolean; error: string;
  initialize(): Promise<void>;
  save(document: WorkbenchDocument): Promise<boolean>;
  toggleFavorite(target: WorkbenchTarget): Promise<void>;
}

/** 独立存储以成功落盘结果更新界面；失败保留旧配置，禁止连续操作覆盖彼此。 */
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  snapshot: { revision: 0, document: emptyWorkbench() }, ready: false, busy: false, error: '',
  initialize: async () => {
    if (get().busy) return;
    set({ busy: true, error: '' });
    try { set({ snapshot: await invoke('workbench.get', {}), ready: true }); }
    catch (error) { set({ error: errorMessage(error), ready: false }); }
    finally { set({ busy: false }); }
  },
  save: async document => {
    if (get().busy || !get().ready) return false;
    set({ busy: true, error: '' });
    try {
      const snapshot = await invoke('workbench.save', { revision: get().snapshot.revision, document: workbenchDocumentSchema.parse(document) });
      set({ snapshot }); return true;
    } catch (error) { set({ error: errorMessage(error) }); useWorkspace.getState().notify(errorMessage(error), true); return false; }
    finally { set({ busy: false }); }
  },
  toggleFavorite: async target => {
    const document = get().snapshot.document;
    const found = document.favorites.some(item => targetKey(item.target) === targetKey(target));
    const favorites = found ? document.favorites.filter(item => targetKey(item.target) !== targetKey(target)) : [...document.favorites, { id: uid(), label: target.kind === 'database' ? target.database : target.name, groupId: null, target }];
    if (await get().save({ ...document, favorites }) && !found) useWorkspace.getState().notify(t.saved);
  }
}));
