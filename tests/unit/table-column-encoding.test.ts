import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { validateColumnPatches } from '../../src/shared/tableColumnPatches';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { deriveIndexCapabilities, deriveTrustedIndexColumn } from '../../src/engine/tableIndexMetadata';
import type { ColumnEncodingFacts } from '../../src/engine/tableColumnEncodingRead';
import { assertColumnEncodingIndexBudget, buildColumnEncodingPlan, checkColumnEncodingRoundtrip, columnEncodingAccess, columnEncodingExecutionMode, verifyColumnEncodingChange } from '../../src/engine/tableColumnEncodingSql';
import type { TableColumnAutoIncrementFacts } from '../../src/engine/tableColumnAutoIncrementRead';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';

const template = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`v` varchar(100) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'é',`amount` decimal(30,6) NOT NULL DEFAULT 0,PRIMARY KEY (`id`),UNIQUE KEY `uq_v` (`v`),KEY `mix` (`v`(20),`amount`)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=10";
/** 目录为明确合成输入；类型/长度/MAXLEN仍走真实deriveTrustedIndexColumn，不伪造生产访问投影。 */
function fixture(source = template, dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13', targetCharset = 'latin1') {
  const context = { dialect, mode: { ansiQuotes:false,noBackslashEscapes:false } }, definition = parseTableColumnDefinition(source,context), indexDocument=readTableIndexDefinition(definition), target=definition.columnsByName.get('v')!, isText=/TEXT/i.test(target.type.raw), length=isText?({TINYTEXT:255,TEXT:65535,MEDIUMTEXT:16777215,LONGTEXT:4294967295} as Record<string,number>)[target.type.raw.toUpperCase()]:Number(/\((\d+)\)/.exec(target.type.raw)![1]), maxlen=targetCharset==='latin1'?1:['utf8','utf8mb3'].includes(targetCharset)?3:4;
  const columns=new Map(definition.columns.map(column=>{
    const text=column.name==='v',type=column.type.raw.split(/[ (]/)[0].toLowerCase();
    return ['r:'+column.name,deriveTrustedIndexColumn(column,{COLUMN_NAME:column.name,DATA_TYPE:type,COLUMN_TYPE:column.type.raw,IS_NULLABLE:column.nullable===false?'NO':'YES',CHARACTER_SET_NAME:text?targetCharset:null,COLLATION_NAME:text?targetCharset+'_bin':null,CHARACTER_MAXIMUM_LENGTH:text?String(length):null,CHARACTER_OCTET_LENGTH:text?String(isText?length:length*maxlen):null,EXTRA:column.name==='id'?'auto_increment':column.default.kind==='expression'?'DEFAULT_GENERATED':''},{definitionContext:context,charsetMaxBytes:maxlen}).column] as const;
  }));
  const indexes=new Map(indexDocument.indexes.map(parsed=>['i:'+parsed.name,{parsed,definition:editableIndexDefinition(parsed,columns),visible:true as const,generated:false as const}]));
  const base={source,context,originalMode:'STRICT_TRANS_TABLES',normalizedMode:'STRICT_TRANS_TABLES',identity:'server',serverVersion:version,warnings:[],nullability:definition.columns.map(column=>[column.name,column.nullable!==false] as [string,boolean]),encodings:definition.columns.map(column=>({name:column.name,charset:column.name==='v'?targetCharset:null,collation:column.name==='v'?targetCharset+'_bin':null})),tableEncoding:{charset:'utf8mb4',collation:'utf8mb4_bin'},columnExtras:definition.columns.map(column=>[column.name,column.name==='id'?'auto_increment':column.default.kind==='expression'?'DEFAULT_GENERATED':''] as [string,string])};
  const core:TableColumnAutoIncrementFacts={physical:{tableId:'100',serverIdentity:'server',dialect,version,os:'Linux',lowerNames:0,catalog:dialect==='mysql'&&version.startsWith('8.')?'INNODB_TABLES':'INNODB_SYS_TABLES',nativeName:'db/t'},columns:definition.columns.map((column,index)=>({name:column.name,ordinal:index+1,typeSql:column.type.raw,dataType:column.type.raw.split(/[ (]/)[0].toLowerCase(),nullable:column.nullable===false?'NO':'YES',defaultValue:column.default.kind==='literal'?column.default.value:column.default.kind==='expression'?column.default.sql:null,extra:column.name==='id'?'auto_increment':column.default.kind==='expression'?'DEFAULT_GENERATED':'',generationExpression:'',charset:column.name==='v'?targetCharset:null,collation:column.name==='v'?targetCharset+'_bin':null,comment:column.comment??''})),indexes:{...base,model:{definition,indexDocument,columns,indexes,dependencies:{incomingCoverage:{kind:'complete',source:'innodb-dictionary'},outgoingComplete:true,foreignKeys:[],autoIncrementColumnRefs:['r:id'],partition:{kind:'none'},hiddenDependencies:[],automaticForeignKeyIndexProvenance:{kind:'known',indexRefs:[]}}},options:{database:'db',dialect,serverVersion:version,engine:'InnoDB',sqlMode:context.mode,capabilities:deriveIndexCapabilities({dialect,serverVersion:version,engine:'InnoDB',rowFormat:'DYNAMIC',pageSize:16384,largePrefix:true}).capabilities!,checks:{foreignKeyChecks:1,uniqueChecks:1}},catalogDigest:'catalog',dependencyDigest:'dependency',bytes:1000},policy:{sessionIncrement:'1',sessionOffset:'1',globalIncrement:'1',globalOffset:'1',lockMode:'1',readOnly:'0',superReadOnly:'0',innodbReadOnly:'0',forceRecovery:'0'},bytes:2000};
  const candidates=[{charset:'latin1',collation:'latin1_bin'},{charset:'utf8mb4',collation:'utf8mb4_bin'},{charset:'utf8mb4',collation:'utf8mb4_general_ci'},...(['utf8','utf8mb3'].includes(targetCharset)?[{charset:targetCharset,collation:targetCharset+'_bin'}]:[])],catalog={candidates,digest:createHash('sha256').update(JSON.stringify([candidates,[]])).digest('hex'),warnings:[],bytes:1000};
  return {base,core,catalog,maxlen:[['latin1',1],['utf8mb4',4],...(['utf8','utf8mb3'].includes(targetCharset)?[[targetCharset,3] as [string,number]]:[])],digest:'facts',bytes:4000} satisfies ColumnEncodingFacts;
}
const next={charset:'utf8mb4',collation:'utf8mb4_bin'};

describe('跨字符集独立契约/完整索引预算和COPY计划',()=>{
  it.each([['mysql','5.7.44','utf8'],['mysql','8.0.46','utf8mb3'],['mysql','8.4.11','utf8mb3'],['mariadb','10.11.19','utf8mb3'],['mariadb','11.4.13','utf8mb3']] as const)('%s%s实际UTF8 3→4逐字节预检不引用弃用旧USING名称', (dialect,version,charset)=>{
    const facts=fixture(template.replace('CHARACTER SET latin1 COLLATE latin1_bin',`CHARACTER SET ${charset} COLLATE ${charset}_bin`),dialect,version,charset),plan=buildColumnEncodingPlan(facts,'r:v',next);
    expect(plan.preflightSql).toContain('CAST(`v` AS BINARY)<=>CAST(CONVERT(`v` USING utf8mb4) AS BINARY)');
    expect(plan.preflightSql).toContain("CAST(X'c3a9' AS BINARY)<=>CAST(CONVERT(X'c3a9' USING utf8mb4) AS BINARY)");
    expect(plan.preflightSql).not.toMatch(/USING utf8(?:mb3)?\b/);expect(plan.sql).toContain('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  });
  it('UTF8名字不替代真实MAXLEN和支持基线证明，反向仍走原双转换',()=>{
    const sql=template.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb3 COLLATE utf8mb3_bin'),facts=fixture(sql,'mysql','8.0.46','utf8mb3');
    facts.maxlen.find(item=>item[0]==='utf8mb3')![1]=4;expect(buildColumnEncodingPlan(facts,'r:v',next).preflightSql).toContain('USING utf8mb4) USING utf8mb3)');
    const mismatched=fixture(sql,'mysql','8.0.46','utf8mb3');mismatched.core.physical.version='8.0.47';expect(buildColumnEncodingPlan(mismatched,'r:v',next).preflightSql).toContain('USING utf8mb4) USING utf8mb3)');
    expect(()=>buildColumnEncodingPlan(fixture(sql,'mysql','8.0.47','utf8mb3'),'r:v',next)).toThrow();
    const reverse=fixture(template.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'),'mysql','8.0.46','utf8mb4');reverse.catalog.candidates.push({charset:'utf8mb3',collation:'utf8mb3_bin'});reverse.maxlen.push(['utf8mb3',3]);expect(buildColumnEncodingPlan(reverse,'r:v',{charset:'utf8mb3',collation:'utf8mb3_bin'}).preflightSql).toContain('USING utf8mb3) USING utf8mb4)');
  });
  it('真实IPC只接受独立配对；省略保持原入口，旧generic明确拒绝',()=>{
    const patch={kind:'alter',columnRef:'r:v',changes:{encoding:next}};expect(validateColumnPatches([patch])).toEqual([patch]);
    expect(validateCommand('schema.columns.get',{connectionId:'c',database:'db',table:'t',taskId:'task',includeEncodingFacts:true})).toMatchObject({includeEncodingFacts:true});
    for(const encoding of [undefined,null,{...next,extra:1},{charset:'utf8mb4;DROP',collation:'utf8mb4_bin'}])expect(()=>validateColumnPatches([{...patch,changes:{encoding}}])).toThrow();
    expect(()=>validateColumnPatches([{...patch,changes:{encoding:next,nullable:false}}])).toThrow('独立');
    expect(()=>validateColumnPatches([patch,{kind:'drop',columnRef:'r:id'}])).toThrow('独立');
    const value=fixture();expect(()=>buildTableColumnPatchSql(value.core.indexes.model.definition,[patch] as any,{database:'db',serverVersion:'8.4.11',columnRefs:new Map([['r:v','v']])})).toThrow('专用');
  });
  it.each([['mysql','5.7.44'],['mysql','8.0.46'],['mysql','8.4.11'],['mariadb','10.11.19'],['mariadb','11.4.13']] as const)('%s%s完整/唯一/复合前缀均可计划且保留原默认/NULL/type/备注', (dialect,version)=>{
    const facts=fixture(template,dialect,version),plan=buildColumnEncodingPlan(facts,'r:v',next);
    expect(plan.sql).toContain("MODIFY COLUMN `v` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");expect(plan.sql).toContain("NOT NULL DEFAULT 'é'");expect(plan.sql).toContain('ALGORITHM=COPY, LOCK=EXCLUSIVE');expect(plan.sql).not.toMatch(/DROP|ADD KEY|CONVERT TO|UPDATE/);
    expect(plan.preflightSql).toContain('COUNT(*)');expect(plan.preflightSql).toContain('MAX(OCTET_LENGTH(CONVERT(`v` USING utf8mb4)))');expect(plan.preflightSql).not.toMatch(/LIMIT|WHERE|SELECT \*/);expect(plan.executionMode).toBe('STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO');
  });
  it('拒绝Maria会自动缩前缀的769*4完整键，以及真实复合前缀总成本超限',()=>{
    const wide=fixture(template.replace('varchar(100)','varchar(769)'));expect(()=>buildColumnEncodingPlan(wide,'r:v',next)).toThrow('MAXLEN');
    const prefix=fixture(template.replace('varchar(100)','varchar(1000)').replace('UNIQUE KEY `uq_v` (`v`),','').replace('`v`(20)','`v`(767)'));
    expect(()=>assertColumnEncodingIndexBudget(prefix,'r:v',next)).toThrow('MAXLEN');
    const allowed=fixture(template.replace('varchar(100)','varchar(1000)').replace('UNIQUE KEY `uq_v` (`v`),','').replace('`v`(20)','`v`(760)'));
    expect(()=>buildColumnEncodingPlan(allowed,'r:v',next)).not.toThrow();
  });
  it('TEXT保留原类型并预检实际转换后最大字节容量，NULL/空表不绕过计数',()=>{
    const facts=fixture(template.replace('varchar(100)','text').replace("NOT NULL DEFAULT 'é'",'NULL').replace('UNIQUE KEY `uq_v` (`v`),','')),plan=buildColumnEncodingPlan(facts,'r:v',next);
    expect(plan.maximumBytes).toBe(65535);expect(plan.sql).toContain('`v` text CHARACTER SET');expect(plan.preflightSql).toContain('>65535');
  });
  it.each(['TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT'])('%s后核按实际原容量保留两长度，不按MAXLEN除法猜测',kind=>{
    const sql=template.replace('varchar(100)',kind).replace("NOT NULL DEFAULT 'é'",'NULL').replace('UNIQUE KEY `uq_v` (`v`),',''),before=fixture(sql),plan=buildColumnEncodingPlan(before,'r:v',next),after=fixture(sql.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'),'mysql','8.4.11','utf8mb4');
    after.base.originalMode=after.base.normalizedMode=plan.executionMode;after.core.physical.tableId='200';expect(verifyColumnEncodingChange(before,after,plan)).toBe(true);after.core.indexes.model.columns.get('r:v')!.characterOctetLength='1';expect(verifyColumnEncodingChange(before,after,plan)).toBe(false);
  });
  it('受控CURRENT_TIMESTAMP旁默认可沿已有门保留，非受控时间表达式仍拒绝',()=>{
    const add=(expression:string)=>template.replace('PRIMARY KEY',`\`created_at\` datetime(6) NOT NULL DEFAULT ${expression},PRIMARY KEY`);
    expect(()=>buildColumnEncodingPlan(fixture(add('CURRENT_TIMESTAMP(6)')),'r:v',next)).not.toThrow();
    expect(()=>buildColumnEncodingPlan(fixture(add('(CURRENT_TIMESTAMP(6)+INTERVAL 1 SECOND)')),'r:v',next)).toThrow('表达式');
  });
  it('FK单列配对和旁generated/CHECK/expr风险只读，不凭目标是否有引用猜保真',()=>{
    const facts=fixture();facts.core.indexes.model.dependencies.foreignKeys=[{foreignKeyRef:'fk',direction:'incoming',targetColumnRefs:['r:v'],support:{kind:'unknown',reason:'未证明'}}];expect(()=>buildColumnEncodingPlan(facts,'r:v',next)).toThrow('外键');
    for(const sql of [template.replace('PRIMARY KEY','`g` int GENERATED ALWAYS AS (`amount`+1) STORED,PRIMARY KEY'),template.replace(') ENGINE',',CHECK (`amount`>0)) ENGINE'),template.replace('DEFAULT 0','DEFAULT (1+1)')]){
      const original=fixture();original.base.source=sql;expect(columnEncodingAccess(original,'r:v').editable).toBe(false);
    }
  });
  it('原模式PAD/NBE/ANSI及严格位均保留，配对未知/同charset/原型敏感名字不注入',()=>{
    expect(columnEncodingExecutionMode('PAD_CHAR_TO_FULL_LENGTH,NO_BACKSLASH_ESCAPES')).toBe('PAD_CHAR_TO_FULL_LENGTH,NO_BACKSLASH_ESCAPES,STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO');
    expect(()=>buildColumnEncodingPlan(fixture(),'r:v',{charset:'latin1',collation:'latin1_bin'})).toThrow('实际字符集');expect(()=>buildColumnEncodingPlan(fixture(),'r:v',{charset:'utf8mb4',collation:'constructor'})).toThrow('唯一');
  });
});

describe('服务器完整往返聚合和后核',()=>{
  /** 仅提供原驱动回调端口，真实structureTaskQuery负责命令终态。 */
  function context(result:unknown,warnings:unknown=[]){const listeners=new Map<string,Function[]>(),sent:string[]=[];const connection={once:(name:string,fn:Function)=>listeners.set(name,[...(listeners.get(name)??[]),fn]),removeListener:()=>{},query:(sql:string,callback:Function)=>{sent.push(sql);queueMicrotask(()=>callback(null,sql.startsWith('SHOW WARNINGS')?warnings:result,[]));}};return{sent,managed:{connection,broken:false} as any,checkCancelled(){},report(){},commandStarted:()=>()=>{}};}
  it.each([{rowCount:'0',lossy:'0',defaultLossy:'0',maxConvertedBytes:'0'},{rowCount:'18446744073709551615',lossy:'0',defaultLossy:'0',maxConvertedBytes:'100'}])('空集或精确大计数不转Number：%j',async row=>{const ctx=context([row]),plan=buildColumnEncodingPlan(fixture(),'r:v',next);await checkColumnEncodingRoundtrip(ctx,plan);expect(ctx.sent[1]).toBe('SHOW WARNINGS LIMIT 21');});
  it.each([{rowCount:'2',lossy:'1',defaultLossy:'0',maxConvertedBytes:'3'},{rowCount:'0',lossy:'0',defaultLossy:'1',maxConvertedBytes:'0'},{rowCount:1,lossy:'0',defaultLossy:'0',maxConvertedBytes:'1'},{rowCount:'1',lossy:'0',defaultLossy:'0',maxConvertedBytes:'1',extra:'x'}])('不完整/有损事实%j拒绝',async row=>{await expect(checkColumnEncodingRoundtrip(context([row]),buildColumnEncodingPlan(fixture(),'r:v',next))).rejects.toThrow();});
  it('任何原SHOW WARNINGS都拒绝，包括替换后可能碰巧相同的值',async()=>{const ctx=context([{rowCount:'1',lossy:'0',defaultLossy:'0',maxConvertedBytes:'1'}],[{Code:1366,Message:'原诊断'}]);await expect(checkColumnEncodingRoundtrip(ctx,buildColumnEncodingPlan(fixture(),'r:v',next))).rejects.toThrow('警告');});
  it('UTF8升级保留默认有损拒绝及1287警告拒绝，不能回退或忽略诊断',async()=>{
    const plan=buildColumnEncodingPlan(fixture(template.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb3 COLLATE utf8mb3_bin'),'mysql','8.0.46','utf8mb3'),'r:v',next),row={rowCount:'4',lossy:'0',defaultLossy:'0',maxConvertedBytes:'3'};
    await expect(checkColumnEncodingRoundtrip(context([{...row,defaultLossy:'1'}]),plan)).rejects.toThrow('原字节');
    const ctx=context([row],[{Code:1287,Level:'Warning',Message:"'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead"}]);await expect(checkColumnEncodingRoundtrip(ctx,plan)).rejects.toThrow('警告');expect(ctx.sent).toEqual([plan.preflightSql,'SHOW WARNINGS LIMIT 21']);
  });
  it('仅目标编码/MAXLEN和COPY物理ID及表计数变化可核验，旁默认/索引/目录不能豁免',()=>{
    const before=fixture(),plan=buildColumnEncodingPlan(before,'r:v',next),after=fixture(template.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'),'mysql','8.4.11','utf8mb4');after.base.originalMode=after.base.normalizedMode=plan.executionMode;after.core.physical.tableId='200';
    expect(verifyColumnEncodingChange(before,after,plan)).toBe(true);
    for(const mutate of [(value:typeof after)=>{value.core.columns[2].defaultValue='9';},(value:typeof after)=>{value.core.columns[1].collation='utf8mb4_general_ci';},(value:typeof after)=>{value.core.indexes.model.columns.get('r:v')!.characterOctetLength='100';},(value:typeof after)=>{value.core.physical.serverIdentity='other';}]){const copy=structuredClone(after);mutate(copy);expect(verifyColumnEncodingChange(before,copy,plan)).toBe(false);}
  });
});
