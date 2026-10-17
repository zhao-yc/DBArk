import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QueryResult } from '../../src/shared/contracts';
import { ResultExportDialog } from '../../src/renderer/components/ResultExportDialog';
vi.mock('../../src/renderer/store',()=>({useWorkspace:(select:any)=>select({tasks:[]})}));
vi.mock('../../src/renderer/components/ResultsGrid',()=>({ResultsGrid:()=>null}));
vi.mock('../../src/renderer/components/ui',()=>({Modal:({title,children}:any)=><section aria-label={title}>{children}</section>,Field:({children}:any)=><label>{children}</label>,ErrorBox:()=>null}));
const result:QueryResult={columns:[{key:'c0',name:'值',type:'BIGINT'}],rows:[{c0:'18446744073709551615'}],truncated:true,elapsedMs:0,statement:''};
describe('真实结果导出对话框范围文案（静态React，外部实际0）',()=>{
 it('正常对照：原全结果入口的标题和已返回范围保持',()=>{const html=renderToStaticMarkup(<ResultExportDialog result={result} tabId="q" onClose={()=>{}}/>);expect(html).toContain('导出已返回结果');expect(html).toContain('已返回 1 行');});
 it('勾选入口明确仅导出所选N行及打开时固定范围，仍保留源截断事实',()=>{const props={result,tabId:'q',selected:true,onClose:()=>{}};const html=renderToStaticMarkup(<ResultExportDialog {...props}/>);expect(html).toContain('导出勾选结果行');expect(html).toContain('仅导出已返回结果中勾选的 1 行');expect(html).toContain('打开时已固定选择快照');expect(html).toContain('此结果已截断');});
});
