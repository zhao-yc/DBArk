import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { ImportPreviewController, type ImportPreviewContext } from '../../src/renderer/importPreview';

const context:ImportPreviewContext={connectionId:'c',database:'db',table:'new_table',fileToken:'file',format:'json',encoding:'utf8'};
/** 元数据只表示实际创建结果；重命名和生成列不能被旧建议映射假装为可写目标。 */
function info():TableInfo{return{database:'db',name:'new_table',engine:'InnoDB',columns:['renamed','other','computed','__proto__'].map(name=>({name,type:'LONGTEXT',nullable:true,generated:name==='computed',defaultValue:null,extra:'',comment:''})),indexes:[],foreignKeys:[],primaryKey:[],editableKey:[],ddl:''};}

describe('新表导入来源全集与建议映射（RAM）',()=>{
  it('第21条才出现的真实源字段仍展示；改名目标留空供人工确认，不退回同名自动映射',async()=>{
    const controller=new ImportPreviewController({metadata:async()=>info(),preview:async()=>({columns:['original'],rows:[{original:'有限前20条样本'}]})},()=>{});
    await controller.prepare(context,{initialMapping:{original:'original',late:'renamed',other:'缺失目标'},sourceColumns:['original','late','other']});
    expect(controller.ready(context)?.sample.columns).toEqual(['original','late','other']);expect(controller.ready(context)?.mapping).toEqual({original:'',late:'renamed',other:''});
    controller.setMapping(context,'original','other');expect(controller.ready(context)?.mapping.original).toBe('other');
  });
  it('原型同名和JSON空源键按自有属性克隆；不存在或生成目标不套用',async()=>{
    const mapping=Object.fromEntries([['__proto__','__proto__'],['constructor','computed'],['','renamed']]);
    const controller=new ImportPreviewController({metadata:async()=>info(),preview:async()=>({columns:['__proto__','constructor',''],rows:[Object.fromEntries([['__proto__','原值'],['constructor','文本'],['','空键']])]})},()=>{});
    await controller.prepare(context,{initialMapping:mapping,sourceColumns:['__proto__','constructor','']});
    const result=controller.ready(context)!;expect(Object.hasOwn(result.mapping,'__proto__')).toBe(true);expect(result.mapping.__proto__).toBe('__proto__');expect(result.mapping.constructor).toBe('');expect(result.mapping['']).toBe('renamed');
    mapping['']='other';expect(result.mapping['']).toBe('renamed');controller.setMapping(context,'constructor','other');expect(controller.ready(context)?.mapping.constructor).toBe('other');
  });
  it('准备首await前冻结建议和全源目录，迟到样本不能加入未检查的源字段',async()=>{
    let resolve!:(value:TableInfo)=>void;const pending=new Promise<TableInfo>(yes=>{resolve=yes;}),mapping={original:'renamed'},columns=['original'];
    const controller=new ImportPreviewController({metadata:()=>pending,preview:async()=>({columns:['original'],rows:[]})},()=>{}),read=controller.prepare(context,{initialMapping:mapping,sourceColumns:columns});
    mapping.original='other';columns.push('伪造后字段');resolve(info());await read;expect(controller.ready(context)?.mapping).toEqual({original:'renamed'});expect(controller.ready(context)?.sample.columns).toEqual(['original']);
    const changed=new ImportPreviewController({metadata:async()=>info(),preview:async()=>({columns:['未inspect字段'],rows:[]})},()=>{});await changed.prepare(context,{initialMapping:{original:'renamed'},sourceColumns:['original']});expect(changed.ready(context)).toBeNull();
  });
});
