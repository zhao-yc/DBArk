import { z } from 'zod';
import { objectUriLimit, type WorkbenchTarget } from './workbench';

export interface ExternalObjectUriState { pending: boolean; active: boolean }
export type ExternalObjectUriRequest =
  | { id: string; kind: 'target'; target: WorkbenchTarget }
  | { id: string; kind: 'error'; code: 'invalid' | 'multiple' | 'changed' };

/** 系统入口只接受空握手或单个请求编号，不能由界面追加地址和命令参数。 */
export const externalObjectUriEmptySchema = z.object({}).strict();
export const externalObjectUriIdSchema = z.object({ id: z.string().uuid() }).strict();
export const externalObjectUriLimits = { uriCharacters: objectUriLimit, argvItems: 128, argvCharacters: 32768 } as const;
