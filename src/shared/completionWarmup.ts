import{analyzeCompletion}from'./completionAnalysis';

/** 本地固定样本初始化语法预测与投影收集；不接收用户SQL、不读取元数据，也不保留样本结果。 */
export function warmupCompletionAnalysis():void{
  const source='WITH records AS (SELECT 1 AS entry) SELECT records. FROM records',offset=source.indexOf('. ')+1;
  const result=analyzeCompletion(source,offset,{ansiQuotes:false,noBackslashEscapes:true});
  if(result.status!=='ready'||!result.relations.some(relation=>relation.source==='cte'&&relation.columns.includes('entry')))throw new Error('补全解析器未通过本地初始化');
}
