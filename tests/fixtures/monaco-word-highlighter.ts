import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';

/** 只提取实际安装类及纯common模块；不导入Monaco浏览器入口或创建原生编辑器。 */
export async function monacoWordHighlighterCore() {
  const require=createRequire(import.meta.url),root=dirname(require.resolve('monaco-editor/package.json')),base=join(root,'esm/vs').replaceAll('\\','/');
  const source=readFileSync(join(root,'esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js'),'utf8'),tree=ts.createSourceFile('wordHighlighter.js',source,ts.ScriptTarget.Latest,true);
  const declarations:string[]=[];
  const names=new Set(['getOccurrencesAtPosition','getOccurrencesAcrossMultipleModels','OccurenceAtPositionRequest','SemanticOccurenceAtPositionRequest','MultiModelOccurenceRequest','computeOccurencesAtPosition','computeOccurencesMultiModel']);
  for(const node of tree.statements){if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name&&names.has(node.name.text))declarations.push(node.getText(tree));}
  /** 上游decorator不在RAM实例化，但constructor、事件回调和全部方法保持实际原文。 */
  function originalClass(name:string){let found='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name&&node.initializer&&ts.isClassExpression(node.initializer))found=node.initializer.getText(tree);ts.forEachChild(node,visit);};visit(tree);if(!found)throw Error('缺少实际Monaco类：'+name);return found;}
  const imports=`export {Delayer,first,createCancelablePromise} from '${base}/base/common/async.js';\nexport {Disposable,DisposableStore} from '${base}/base/common/lifecycle.js';\nexport {Emitter} from '${base}/base/common/event.js';\nexport {ResourceMap} from '${base}/base/common/map.js';\nexport {URI} from '${base}/base/common/uri.js';\nexport {isEqual} from '${base}/base/common/resources.js';\nexport {Range} from '${base}/editor/common/core/range.js';\nexport {CancellationError,errorHandler,onUnexpectedError,onUnexpectedExternalError,isCancellationError} from '${base}/base/common/errors.js';`;
  const bundled=await build({stdin:{contents:imports,resolveDir:process.cwd(),sourcefile:'monaco-common.ram.js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node22',logLevel:'silent'});
  const module={exports:{} as any};vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,performance,process,console,URL,TextEncoder,TextDecoder});
  return{common:module.exports,source,classes:declarations.join('\n')+`\nvar WordHighlighter_1,WordHighlighterContribution_1; var WordHighlighter=${originalClass('WordHighlighter')};var WordHighlighterContribution=${originalClass('WordHighlighterContribution')};exports.Contribution=WordHighlighterContribution;`};
}

/** 原高亮算法和请求链真实执行；只替换编辑器、模型及语言provider的RAM端口。 */
export function wordHighlighterHarness(core:Awaited<ReturnType<typeof monacoWordHighlighterCore>>,readOnly:boolean,mode='singleFile'){
  const {common}=core,events=new Map<string,any>(),emitters:any[]=[],reported:unknown[]=[],notifications:unknown[]=[],ranges:any[]=[];let active=true,focused=false,requests=0,references=0,context=false,contribution:any;
  common.errorHandler.unexpectedErrorHandler=(error:unknown)=>reported.push(error);common.errorHandler.listeners.push((error:unknown)=>notifications.push(error));
  const subscribe=(name:string)=>{const emitter=new common.Emitter();emitters.push(emitter);events.set(name,emitter);return emitter.event;};
  const selection={startLineNumber:1,endLineNumber:1,startColumn:2,endColumn:2,getPosition:()=>({lineNumber:1,column:2})};
  const model={uri:common.URI.parse('inmemory://ram/model'),isTooLargeForTokenization:()=>false,isDisposed:()=>!active,getWordAtPosition:()=>({word:'value',startColumn:1,endColumn:6})};
  const decorations={get length(){return ranges.length;},clear(){ranges.splice(0);},set(values:any[]){ranges.splice(0,ranges.length,...values);},getRanges:()=>ranges.map(value=>value.range)};
  const editor={readOnly,hasModel:()=>active,getModel:()=>active?model:null,hasTextFocus:()=>focused,getSelection:()=>selection,getPosition:()=>selection.getPosition(),getContribution:()=>contribution,
    getOption:(option:number)=>option===90?mode:option===148?' ':undefined,createDecorationsCollection:()=>decorations,removeDecorations(){},changeDecorations:(callback:(value:any)=>unknown)=>callback({deltaDecorations:(_old:unknown,values:any[])=>values.map((_,index)=>'ram-'+index)}),
    onDidChangeCursorPosition:subscribe('cursor'),onDidFocusEditorText:subscribe('focus'),onDidChangeModelContent:subscribe('content'),onDidChangeModel:subscribe('model'),onDidChangeConfiguration:subscribe('options'),onDidBlurEditorWidget:subscribe('blur')};
  const provider={provideDocumentHighlights(){requests++;return[{range:new common.Range(1,1,1,6),kind:1},{range:new common.Range(1,9,1,14),kind:1}];}};
  const scope={...common,exports:{} as any,ctxHasWordHighlights:{bindTo:()=>({set(value:boolean){context=value;}})},Schemas:{vscodeNotebookCell:'vscode-notebook-cell',accessibleView:'accessible-view'},matchesScheme:()=>false,isDiffEditor:()=>false,getHighlightDecorationOptions:()=>({description:'RAM词语出现高亮'}),setTimeout,clearTimeout};
  vm.runInNewContext(core.classes,scope);
  contribution=new scope.exports.Contribution(editor,{}, {documentHighlightProvider:{ordered:()=>[provider]},multiDocumentHighlightProvider:{ordered:()=>[]}}, {getFocusedCodeEditor:()=>focused?editor:null,listCodeEditors:()=>[editor]}, {createModelReference:async()=>({object:{textEditorModel:model},dispose(){references++;}})}, {getValue:()=>0,onDidChangeConfiguration:subscribe('configuration')}, {error(error:unknown){reported.push(error);}});
  return{common,editor,contribution,get highlighter(){return contribution.wordHighlighter;},reported,notifications,ranges,get requests(){return requests;},get references(){return references;},get hasHighlights(){return context;},
    fire(event:'focus'|'cursor'){focused=true;events.get(event).fire({source:'api',reason:3});},
    unbind(){focused=false;active=false;events.get('model').fire({oldModelUrl:model.uri,newModelUrl:null});},
    dispose(){focused=false;contribution.dispose();for(const emitter of emitters)emitter.dispose();}};
}
