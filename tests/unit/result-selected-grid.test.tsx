import { act } from 'react';
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
import { memoryDocument } from '../fixtures/memory-dom';
import { ResultsGrid } from '../../src/renderer/components/ResultsGrid';
import { ResultExportSelection } from '../../src/renderer/resultExport';
const grid=vi.hoisted(()=>({props:null as any}));
vi.mock('react-data-grid',()=>({DataGrid:(props:any)=>{grid.props=props;return null;},SelectColumn:{key:'select'}}));
// 保留真实Zustand订阅语义；本例不打开二进制模态，不模拟文件能力或接纳门。
vi.mock('../../src/renderer/store',async()=>{const{create}=await import('zustand');return{useWorkspace:create(()=>({settings:{theme:'light',dataTypeColors:false}}))};});
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
beforeAll(async()=>{document=memoryDocument();({createRoot}=await import('react-dom/client'));});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
describe('实际ResultsGrid同步选择归属（内存ReactDOM）',()=>{
 it('数组或scope切换在effect前清选择，迟到旧网格回调不得覆盖新选择',async()=>{
  const a={rows:[{c0:'甲'}],columns:[{key:'c0',name:'x',type:'TEXT'}]},b={rows:[{c0:'乙'}],columns:[...a.columns]},scopeA={},scopeB={},changed=vi.fn(()=>true);
  const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as unknown as Element);
  await act(async()=>root!.render(<ResultsGrid {...a} selectionScope={scopeA} onSelectionChange={changed}/>));
  const old=grid.props.onSelectedRowsChange;await act(async()=>old(new Set([0])));expect(changed).toHaveBeenLastCalledWith({scope:scopeA,...a,indices:new Set([0])});
  await act(async()=>root!.render(<ResultsGrid {...b} selectionScope={scopeB} onSelectionChange={changed}/>));expect(grid.props.selectedRows.size).toBe(0);
  await act(async()=>grid.props.onSelectedRowsChange(new Set([0])));const count=changed.mock.calls.length;
  await act(async()=>old(new Set()));expect(changed).toHaveBeenCalledTimes(count);expect(grid.props.selectedRows).toEqual(new Set([0]));
  await act(async()=>root!.render(<ResultsGrid {...a} selectionScope={{}} onSelectionChange={changed}/>));await act(async()=>old(new Set([0])));expect(changed).toHaveBeenCalledTimes(count);expect(grid.props.selectedRows.size).toBe(0);
 });
 it('父级在模态期间拒绝迟到选择时，网格勾选与可导出快照仍一致',async()=>{
  const result={rows:[{c0:'甲'},{c0:'乙'}],columns:[{key:'c0',name:'值',type:'TEXT'}],elapsedMs:0,truncated:false,statement:''};
  const selection=new ResultExportSelection(),binding=selection.bind(result,['current'])!;
  let modal=false;
  // 模态门是父端口；真正网格和导出快照仍使用生产实现，不在内存里复制状态机。
  const accept=vi.fn((event:Parameters<ResultExportSelection['select']>[1])=>!modal&&selection.select(binding,event));
  const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as unknown as Element);
  await act(async()=>root!.render(<ResultsGrid columns={result.columns} rows={result.rows} selectionScope={binding} onSelectionChange={accept}/>));
  await act(async()=>grid.props.onSelectedRowsChange(new Set([0])));
  expect(grid.props.selectedRows).toEqual(new Set([0]));expect(selection.snapshot(binding).rows).toEqual([{c0:'甲'}]);
  modal=true;await act(async()=>grid.props.onSelectedRowsChange(new Set([1])));
  expect(accept).toHaveLastReturnedWith(false);expect(grid.props.selectedRows).toEqual(new Set([0]));
  modal=false;expect(selection.snapshot(binding).rows).toEqual([{c0:'甲'}]);
  await act(async()=>grid.props.onSelectedRowsChange(new Set([1])));
  expect(grid.props.selectedRows).toEqual(new Set([1]));expect(selection.snapshot(binding).rows).toEqual([{c0:'乙'}]);
 });
});
