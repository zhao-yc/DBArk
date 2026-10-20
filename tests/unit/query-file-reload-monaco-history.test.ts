import { expect, it } from 'vitest';
import { beginEditorReload, editorContentBridge } from '../../src/renderer/editorContentBridge';
import { queryFileSourceSqlDigest } from '../../src/shared/queryFileSources';
// @ts-expect-error 实际Monaco内存模块没有单独的声明文件。
import { Selection } from 'monaco-editor/esm/vs/editor/common/core/selection.js';
// @ts-expect-error 同上，历史元素及序列化使用正式实现。
import { TextModel } from 'monaco-editor/esm/vs/editor/common/model/textModel.js';
// @ts-expect-error 同上，普通编辑经过正式Cursor控制器。
import { CursorsController } from 'monaco-editor/esm/vs/editor/common/cursor/cursor.js';

/** 正文、EOL、编辑/历史元素和回放为真实Monaco TextModel；仅语言服务、UI光标及Undo服务为RAM。 */
function port(initial: string, initialEol: string) {
  let index=0, readonly=false, props={value:initial,readOnly:false,onChange:(value:string)=>{props.value=value;}};
  const history:any[]=[];let selections:any[]=[new Selection(1,2,1,2)];
  const off=()=>({dispose(){}}),language={onDidChange:off,getLanguageConfiguration:()=>({})};
  const tokenization={onDidChangeLanguage:off,onDidChangeLanguageConfiguration:off,onDidChangeTokens:off,getLanguageId:()=> 'plaintext',handleDidChangeContent(){},handleDidChangeAttached(){},dispose(){}};
  const model=new TextModel(initial,'plaintext',{...TextModel.DEFAULT_CREATION_OPTIONS,defaultEOL:initialEol==='\r\n'?2:1,bracketPairColorizationOptions:{enabled:false,independentColorPoolPerBracketType:false}},null,{getLastElement:()=>history[index-1],pushElement(element:any){history.splice(index);history.push(element);index++;},getElements:()=>({past:[],future:[]}),createSnapshot:()=>({}),removeElements(){}},{requestRichLanguageFeatures(){}},language,{createInstance:()=>tokenization});
  const undo=model._applyUndo.bind(model),redo=model._applyRedo.bind(model);
  model._applyUndo=(...args:any[])=>{undo(...args);if(args[3])selections=args[3];};model._applyRedo=(...args:any[])=>{redo(...args);if(args[3])selections=args[3];};
  const cursor={_model:model,getSelections:()=>selections,setSelections(_event:unknown,_source:unknown,value:any){selections=value;}};
  const editor:any={getModel:()=>model,getSelections:()=>selections,getRawOptions:()=>({readOnly:readonly}),updateOptions(value:any){readonly=value.readOnly;},onDidChangeModel:off,onDidDispose:off};
  const bridge=editorContentBridge(editor,()=>props,()=>{});
  return {editor,model,bridge,props:()=>props.value,setProps(value:string){props.value=value;bridge.sync();},text:()=>model.getValue(),eol:()=>model.getEOL(),readonly:()=>readonly,selected:()=>selections.map(s=>[s.selectionStartLineNumber,s.selectionStartColumn,s.positionLineNumber,s.positionColumn]),history:()=>history.length,
    type(text:string){CursorsController.prototype.executeEdits.call(cursor,{},'type',[{range:selections[0],text}],(inverse:any[])=>inverse.map(({range})=>Selection.fromPositions(range.getEndPosition())));model.pushStackElement();},
    undo(){history[--index].undo();},redo(){history[index++].redo();}};
}
it.each([['\n', '\r\n'], ['\r\n', '\n']])('重载保留同一模型及普通历史，正文/EOL分步Undo→Redo恢复，%j→%j', async (beforeEol, afterEol) => {
  const old = 'select 1;' + beforeEol, next = 'SELECT 2;' + afterEol + '-- 外部' + afterEol, p = port(old, beforeEol), originalModel = p.model;
  p.type('x'); const draft = p.text(), beforeSelection = p.selected();
  const held = beginEditorReload(p.editor, p.props()); expect(p.readonly()).toBe(true); let binding = { revision: 1, savedSqlDigest: await queryFileSourceSqlDigest(old) };
  expect(held.apply(next, () => { binding = { revision: 2, savedSqlDigest: '' }; p.setProps(next); })).toBe(true); held.dispose(); binding.savedSqlDigest = await queryFileSourceSqlDigest(next);
  expect(p.model).toBe(originalModel); expect(p.text()).toBe(next); expect(p.eol()).toBe(afterEol); expect(p.readonly()).toBe(false);
  p.undo(); expect(p.text()).toBe(draft.replace(/\r\n|\r|\n/g, afterEol)); expect(p.eol()).toBe(afterEol); expect(p.selected()).toEqual(beforeSelection); expect(await queryFileSourceSqlDigest(p.props())).not.toBe(binding.savedSqlDigest); expect(binding.revision).toBe(2);
  p.undo(); expect(p.text()).toBe(draft); expect(p.eol()).toBe(beforeEol); expect(p.selected()).toEqual(beforeSelection);
  p.redo(); expect(p.eol()).toBe(afterEol); p.redo(); expect(p.text()).toBe(next); expect(p.selected()).toHaveLength(1); p.undo(); p.undo(); p.undo(); expect(p.text()).toBe(old); p.redo(); expect(p.text()).toBe(draft); p.redo(); p.redo(); expect(p.text()).toBe(next); p.bridge.dispose();
});
it('混合/裸CR文件原文和基线保留，模型采用LF；取消无编辑，旧受控回包不能解除模型锁', () => {
  const p = port('SELECT 1;\n', '\n'), history = p.history(), held = beginEditorReload(p.editor, p.props()); p.bridge.sync(); expect(p.readonly()).toBe(true); held.dispose(); expect(p.text()).toBe('SELECT 1;\n'); expect(p.history()).toBe(history);
  const reloading = beginEditorReload(p.editor, p.props()), raw = '甲\r\n乙\n丙\r'; reloading.apply(raw, () => p.setProps(raw)); reloading.dispose(); expect(p.props()).toBe(raw); expect(p.text()).toBe('甲\n乙\n丙\n'); expect(p.eol()).toBe('\n'); p.undo(); expect(p.text()).toBe('SELECT 1;\n'); p.bridge.dispose();
});
it('正文版本或props离开原值永久阻止旧确认，不改新文本；相同正文重载不新增历史项', () => {
  const p = port('SELECT 1;\n', '\n'), held = beginEditorReload(p.editor, p.props()); p.type('x'); expect(held.current()).toBe(false); expect(held.apply('旧结果', () => {})).toBe(false); held.dispose(); expect(p.text()).toContain('x'); p.bridge.dispose();
  const same = port('SELECT 1;\n', '\n'), before = same.history(), lease = beginEditorReload(same.editor, same.props()); lease.apply(same.props(), () => {}); lease.dispose(); expect(same.history()).toBe(before); same.bridge.dispose();
});
