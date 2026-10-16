import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type * as monaco from 'monaco-editor';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import {SavedQueryNavigation,exactSavedQueryModelRanges,type SavedQueryNavigationState} from '../../src/renderer/savedQueryNavigation';
import {compileSavedQueryPattern,matchSavedQueryRecord} from '../../src/main/savedQuerySearchMatch';
import type {SavedQueryNavigationSource} from '../../src/shared/savedQuerySearch';

type BufferPort={dispose():void};
let Builder:new()=>{acceptChunk(value:string):void;finish():{create(eol:number):{textBuffer:BufferPort}}},modelPrototype:monaco.editor.ITextModel;
/** 仅导入已安装Monaco的真实文本缓冲和模型原型；没有浏览器、窗口或编辑器启动。 */
beforeAll(async()=>{
 const require=createRequire(import.meta.url),root=dirname(require.resolve('monaco-editor/package.json'));
 const buffer=await import(/* @vite-ignore */ pathToFileURL(join(root,'esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js')).href);
 const model=await import(/* @vite-ignore */ pathToFileURL(join(root,'esm/vs/editor/common/model/textModel.js')).href);
 Builder=buffer.PieceTreeTextBufferBuilder;modelPrototype=model.TextModel.prototype;
});

/** 受控正则仅测试生产Worker纯函数，模型位置/范围校验使用真实Monaco实现，编辑器为只观察端口。 */
function fixture(sql:string,pattern:string,mode:'contains'|'regexp'|'whole'='regexp'){
 const input={taskId:randomUUID(),scope:{kind:'all' as const},database:{kind:'all' as const},fields:['sql' as const],pattern:{mode,text:pattern,caseSensitive:true},maxResults:1000,onError:'stop' as const};
 const hit=matchSavedQueryRecord('q',JSON.stringify({id:'q',name:'自有正文',sql,updatedAt:''}),compileSavedQueryPattern(input))!;
 const builder=new Builder();builder.acceptChunk(sql);const{textBuffer}=builder.finish().create(1);
 const model=Object.assign(Object.create(modelPrototype),{_buffer:textBuffer,_isDisposed:false,getValue:()=>sql,getVersionId:()=>1,onDidChangeContent:()=>({dispose(){}}),onWillDispose:()=>({dispose(){}})}) as monaco.editor.ITextModel;
 const positions:number[]=[],decorationOffsets:{start:number;end:number}[][]=[];
 const collection={set:vi.fn((values:monaco.editor.IModelDeltaDecoration[])=>{decorationOffsets.push(values.map(value=>{const range=model.validateRange(value.range);return{start:model.getOffsetAt({lineNumber:range.startLineNumber,column:range.startColumn}),end:model.getOffsetAt({lineNumber:range.endLineNumber,column:range.endColumn})};}));}),clear:vi.fn()};
 const editor={getModel:()=>model,createDecorationsCollection:vi.fn(()=>collection),onDidChangeModel:()=>({dispose(){}}),onDidDispose:()=>({dispose(){}}),setPosition:vi.fn((position:monaco.IPosition)=>{positions.push(model.getOffsetAt(model.validatePosition(position)));}),revealPositionInCenter:vi.fn(),focus:vi.fn()};
 const source:SavedQueryNavigationSource={queryId:hit.query.id,digest:hit.digest,sql,connectionId:'local',connectionVersion:0,occurrences:hit.sqlOccurrences!},snapshot=JSON.stringify(source),states:SavedQueryNavigationState[]=[];
 let navigation:SavedQueryNavigation|undefined;
 return{source,snapshot,model,editor,collection,positions,decorationOffsets,states,start:()=>navigation=new SavedQueryNavigation(editor as unknown as monaco.editor.IStandaloneCodeEditor,source,()=>({sql,connectionId:'local',connectionVersion:0,sourceBinding:{id:'q',digest:hit.digest,context:{state:'unknown'}}}),state=>states.push(state)),close:()=>{navigation?.dispose();textBuffer.dispose();}};
}

const positives=[
 ['Unicode普通命中','😀x x','x','contains'],
 ['CRLF后普通文字','a\r\nb b','b','contains'],
 ['Unicode零宽及末尾','-- 😀 😀','(?=😀)|$','regexp'],
 ['完整CRLF范围','a\r\nb','\\r\\n','regexp'],
 ['CR之前零宽','a\r\nb','(?=\\r)','regexp'],
 ['CRLF之后零宽','a\r\nb','(?<=\\n)','regexp'],
 ['LF字符','a\nb','\\n','regexp'],
 ['LF前后各零宽','a\nb','(?=\\n)|(?<=\\n)','regexp'],
 ['Unicode跨行范围','😀\r\nb','😀\\r\\nb','regexp'],
 ['CRLF正文末尾','a\r\nb','$','regexp'],
 ['空正文相等','', '', 'whole'],
 ['空CRLF行两端','\r\n','^|$','regexp'],
] as const;
const negatives=[
 ['原反例：CR与LF前各一处零宽','(?=\\r)|(?=\\n)'],
 ['原反例：仅LF前零宽','(?=\\n)'],
 ['原反例：仅LF字符','\\n'],
 ['仅CR字符结束在CRLF内部','\\r'],
 ['跨行范围终点落入CRLF内部','a\\r'],
] as const;

describe('真实Monaco模型无损UTF16往返',()=>{
 it.each(positives)('%s保持完整命中、精确光标及装饰跨度',(_,sql,pattern,mode)=>{
  const test=fixture(sql,pattern,mode);try{
   const navigation=test.start(),ranges=test.source.occurrences.ranges;
   for(let index=1;index<ranges.length;index++)navigation.move(1);
   expect(test.positions).toEqual(ranges.map(span=>span.offset));
   expect(test.decorationOffsets[0]).toEqual(ranges.map(span=>({start:span.offset,end:span.offset+span.length})));
   expect(test.states.at(-1)).toMatchObject({status:'ready',count:ranges.length});expect(JSON.stringify(test.source)).toBe(test.snapshot);
  }finally{test.close();}
 });
 it.each(negatives)('%s整组明确降级，零装饰零展示计数，不丢原始命中',(_,pattern)=>{
  const test=fixture('a\r\nb',pattern);try{
   expect(test.source.occurrences.ranges.length).toBeGreaterThan(0);
   const navigation=test.start();expect(test.states).toEqual([{status:'unlocatable',index:0,count:0,limitReached:false}]);
   expect(test.editor.createDecorationsCollection).not.toHaveBeenCalled();expect(test.positions).toEqual([]);
   navigation.move(1);navigation.move(-1);expect(test.states.at(-1)?.status).toBe('unlocatable');expect(JSON.stringify(test.source)).toBe(test.snapshot);
  }finally{test.close();}
 });
 it('导航前重新验证，映射变得有损时清除旧装饰/计数，恢复映射也不复活',()=>{
  const test=fixture('ab','a|b');try{
   const navigation=test.start(),original=test.model.validatePosition.bind(test.model);
   test.model.validatePosition=position=>original({...position,column:1});
   navigation.move(1);expect(test.collection.clear).toHaveBeenCalledTimes(1);expect(test.positions).toEqual([0]);expect(test.states.at(-1)).toMatchObject({status:'unlocatable',count:0});
   test.model.validatePosition=original;navigation.move(-1);expect(test.positions).toEqual([0]);expect(test.states.at(-1)?.status).toBe('unlocatable');
  }finally{test.close();}
 });
 it('端点可表示但实际范围被扩大时也拒绝，不能只验证光标',()=>{
  const test=fixture('ab','a');try{
   const original=test.model.validateRange.bind(test.model);test.model.validateRange=range=>original({...range,endColumn:range.endColumn+1});
   expect(exactSavedQueryModelRanges(test.model,test.source.occurrences.ranges)).toBeUndefined();test.start();expect(test.states.at(-1)).toMatchObject({status:'unlocatable',count:0});expect(test.editor.createDecorationsCollection).not.toHaveBeenCalled();
  }finally{test.close();}
 });
 it('设置光标后重入造成范围有损时不能再曝光ready计数',()=>{
  const test=fixture('ab','a|b');try{
   const navigation=test.start(),original=test.model.validateRange.bind(test.model);
   test.editor.setPosition.mockImplementationOnce(position=>{test.positions.push(test.model.getOffsetAt(test.model.validatePosition(position)));test.model.validateRange=range=>original({...range,endColumn:range.endColumn+1});});
   navigation.move(1);expect(test.states.at(-1)).toMatchObject({status:'unlocatable',count:0});expect(test.collection.clear).toHaveBeenCalledTimes(1);
  }finally{test.close();}
 });
});
