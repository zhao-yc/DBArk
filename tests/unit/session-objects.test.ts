import {describe,it,expect} from 'vitest';
import {SessionObjects} from '../../src/engine/sessionObjects';
import {sessionObjectAction} from '../../src/engine/sessionObjectSyntax';
import {sessionObjectLimits} from '../../src/shared/sessionObjects';
import {validateCommand} from '../../src/shared/validation';
const mode={ansiQuotes:false,noBackslashEscapes:false},schema='临时库';
/** 只有实际成功终态才由连接观察器调用observe；纯目录没有数据库或文件依赖。 */
function create(catalog:SessionObjects,sql='CREATE TEMPORARY TABLE subject(id INT PRIMARY KEY,note TEXT)'){catalog.observe(sql,schema,mode,'mysql');}
const fields=(catalog:SessionObjects,table='subject',database=schema)=>catalog.completion({kind:'columns',database,table,prefix:''});

describe('查询会话临时对象目录',()=>{
  it('每个会话独立，完整字段遮蔽同名永久表，隐形字段保留可见性',()=>{
    const a=new SessionObjects(0),b=new SessionObjects(0);create(a,'CREATE TEMPORARY TABLE subject(id BIGINT PRIMARY KEY,hidden INT INVISIBLE,`__proto__` TEXT)');create(b,'CREATE TEMPORARY TABLE subject(other_column DECIMAL(40,8))');
    expect(fields(a).handled).toBe(true);expect(fields(a).entries.map(c=>c.name)).toEqual(['id','hidden','__proto__']);expect(fields(a).entries[1].visible).toBe(false);expect(fields(b).entries.map(c=>c.name)).toEqual(['other_column']);expect(fields(a).incomplete).toBe(false);
  });
  it('非临时建表、定义例程、普通查询不会虚构临时表',()=>{
    const c=new SessionObjects(0);for(const sql of['CREATE TABLE subject(id INT)',"CREATE PROCEDURE p() BEGIN CREATE TEMPORARY TABLE subject(id INT);END",'SELECT 1','BEGIN','COMMIT'])create(c,sql);expect(c.snapshot().objects).toEqual([]);expect(fields(c).handled).toBe(false);
  });
  it('数据库和表名中的点、空格和反引号按单段保留',()=>{
    const c=new SessionObjects(0);create(c,'CREATE TEMPORARY TABLE `库.名`.`表``名.点` (`字段.名` INT,`;` TEXT)');expect(fields(c,'表`名.点','库.名').entries.map(column=>column.name)).toEqual(['字段.名',';']);
  });
  it('IF NOT EXISTS不以新定义覆盖已有表，未知对象保持待读',()=>{
    const c=new SessionObjects(0);create(c);create(c,'CREATE TEMPORARY TABLE IF NOT EXISTS subject(wrong_column INT)');expect(fields(c).entries.map(c=>c.name)).toEqual(['id','note']);c.invalidate();create(c,'CREATE TEMPORARY TABLE IF NOT EXISTS subject(wrong_column INT)');expect(fields(c).entries).toEqual([]);expect(fields(c).incomplete).toBe(true);
  });
  it.each(['CREATE TEMPORARY TABLE subject LIKE source_table','CREATE TEMPORARY TABLE subject AS SELECT * FROM source_table','CREATE TEMPORARY TABLE subject(added INT) SELECT note FROM source_table'])('%s保留遮蔽而不假定完整字段',sql=>{const c=new SessionObjects(0);create(c,sql);expect(fields(c).handled).toBe(true);expect(fields(c).incomplete).toBe(true);expect(c.snapshot().objects[0].name).toBe('subject');});
  it('ALTER增删改名和顺序按成功动作更新，约束不能成为字段',()=>{
    const c=new SessionObjects(0);create(c);create(c,'ALTER TABLE subject ADD COLUMN first_column INT FIRST, CHANGE COLUMN note renamed VARCHAR(20) AFTER id,ADD INDEX ix(renamed),DROP COLUMN id');expect(fields(c).entries.map(c=>c.name)).toEqual(['first_column','renamed']);expect(fields(c).incomplete).toBe(false);
    create(c,'ALTER TABLE subject ADD (a INT,b TEXT),RENAME COLUMN a TO changed');expect(fields(c).entries.map(c=>c.name)).toEqual(['first_column','renamed','changed','b']);
  });
  it('跨库改名后旧名称恢复永久目录，新名称继续遮蔽',()=>{
    const c=new SessionObjects(0);create(c);create(c,'ALTER TABLE subject RENAME TO `新库`.`新表`');expect(fields(c).handled).toBe(false);expect(fields(c,'新表','新库').entries.map(c=>c.name)).toEqual(['id','note']);
    c.observe('DROP TEMPORARY TABLE IF EXISTS `新库`.`新表`',undefined,mode,'mysql');expect(fields(c,'新表','新库').handled).toBe(false);
  });
  it('多对象删除和回滚只按真实DDL变化，回滚不复活已删定义',()=>{
    const c=new SessionObjects(0);create(c);create(c,'CREATE TEMPORARY TABLE other(id INT)');create(c,'ROLLBACK');expect(c.snapshot().objects).toHaveLength(2);create(c,'DROP TABLE subject,other');create(c,'ROLLBACK');expect(c.snapshot().objects).toHaveLength(0);expect(fields(c).handled).toBe(false);
  });
  it('不透明执行使旧不存在记录失效，不可回退永久表；显式确认恢复单个目标',()=>{
    const c=new SessionObjects(0);create(c);c.invalidate();c.confirm(schema,'subject',null);expect(fields(c).handled).toBe(false);create(c,'CALL creates_or_drops_objects()');expect(fields(c).handled).toBe(true);expect(fields(c).entries).toEqual([]);c.confirm(schema,'subject',[{name:'actual',visible:true}]);expect(fields(c).entries.map(c=>c.name)).toEqual(['actual']);expect(fields(c).incomplete).toBe(false);
  });
  it('普通查询错误不破坏目录，可能部分DDL失败只影响目标名称',()=>{
    const c=new SessionObjects(0);create(c);c.error('SELECT missing',schema,mode,'mysql');expect(fields(c).incomplete).toBe(false);c.error('ALTER TABLE subject ADD bad UNKNOWN_TYPE',schema,mode,'mysql');expect(fields(c).handled).toBe(true);expect(fields(c).incomplete).toBe(true);expect(c.completion({kind:'columns',database:schema,table:'unrelated',prefix:''}).handled).toBe(false);
  });
  it('内置表达式与已确认临时来源保持目录，函数和未确认来源需显式读回',()=>{
    const c=new SessionObjects(0);create(c);for(const sql of['SELECT CONNECTION_ID(),COUNT(*) FROM subject','INSERT INTO subject(id,note) VALUES(1,\'a\')','UPDATE subject SET id=2 WHERE id=1','SELECT ROW_COUNT()'])create(c,sql);expect(fields(c).incomplete).toBe(false);
    create(c,'SELECT custom_function()');expect(fields(c).incomplete).toBe(true);c.confirm(schema,'subject',[{name:'actual',visible:true}]);create(c,'SELECT * FROM possible_view');expect(fields(c).entries).toEqual([]);
  });
  it('失败的简单CREATE不虚构临时遮蔽，REPLACE失败仍需核对',()=>{const c=new SessionObjects(0);c.error('CREATE TEMPORARY TABLE subject(id INT)',schema,mode,'mysql');expect(fields(c).handled).toBe(false);c.error('CREATE OR REPLACE TEMPORARY TABLE subject(id INT)',schema,mode,'mariadb');expect(fields(c).handled).toBe(true);});
  it('可见性ALTER实时更新，不能从引擎转换猜实际字段完整',()=>{const c=new SessionObjects(0);create(c);create(c,'ALTER TABLE subject ALTER COLUMN note SET INVISIBLE');expect(fields(c).entries.find(value=>value.name==='note')?.visible).toBe(false);create(c,'ALTER TABLE subject ENGINE=MEMORY');expect(fields(c).incomplete).toBe(true);});
  it('未实现的MariaDB条件ALTER清空旧字段，不能虚构名为IF的列',()=>{const c=new SessionObjects(0);create(c);c.observe('ALTER TABLE subject ADD COLUMN IF NOT EXISTS added INT',schema,mode,'mariadb');expect(fields(c).entries).toEqual([]);expect(fields(c).incomplete).toBe(true);});
  it('无显式主键的MySQL声明不能排除服务器自动隐形主键，字段摘要保留但标部分',()=>{const c=new SessionObjects(0);create(c,'CREATE TEMPORARY TABLE subject(actual_column INT)');expect(fields(c).entries.map(value=>value.name)).toEqual(['actual_column']);expect(fields(c).incomplete).toBe(true);});
  it.each([0,1,2]as const)('服务器大小写规则%s隔离名称',caseMode=>{const c=new SessionObjects(caseMode);create(c,'CREATE TEMPORARY TABLE Subject(id INT)');expect(fields(c,'subject').handled).toBe(caseMode!==0);});
  it('未知ANSI模式只采用候选一致的对象，字符串默认值不进入摘要',()=>{
    const c=new SessionObjects(0);c.observe('CREATE TEMPORARY TABLE `subject` (`name` VARCHAR(20) DEFAULT \'private_default\')',schema,{...mode,ansiQuotesKnown:false,noBackslashEscapesKnown:false},'mysql');expect(JSON.stringify(c.snapshot())).not.toContain('private_default');expect(fields(c).entries.map(c=>c.name)).toEqual(['name']);expect(sessionObjectAction('CREATE TEMPORARY TABLE "subject"(x INT)',schema,{...mode,ansiQuotesKnown:false},'mysql').kind).toBe('opaque');
  });
  it('预算淘汰后仍阻止未知名称回退，并能显式刷新新的对象',()=>{
    const c=new SessionObjects(0);for(let n=0;n<=sessionObjectLimits.objects;n++)create(c,`CREATE TEMPORARY TABLE t${n}(id INT)`);expect(c.snapshot().objects.length).toBeLessThanOrEqual(sessionObjectLimits.objects);expect(c.snapshot().uncertain).toBe(true);expect(fields(c,'t0').handled).toBe(true);c.confirm(schema,'last',[{name:'field',visible:true}]);expect(fields(c,'last').entries.map(c=>c.name)).toEqual(['field']);
  });
  it('前缀结果有限、繁忙快照不交付中间状态、返回值不可修改缓存',()=>{
    const c=new SessionObjects(0);c.confirm(schema,'subject',Array.from({length:300},(_,n)=>({name:'c'+n,visible:true})));const result=fields(c);expect(result.entries).toHaveLength(256);expect(result.incomplete).toBe(true);result.entries[0].name='corrupted';expect(fields(c).entries[0].name).toBe('c0');expect(c.snapshot(true).objects).toEqual([]);expect(c.snapshot(false,true).objects).toEqual([]);
  });
  it('新IPC严格限制会话对象目标，拒绝SQL与文件参数注入',()=>{
    expect(()=>validateCommand('query.temporaryRead',{sessionId:'s',taskId:'t',database:'db',table:'table'})).not.toThrow();for(const extra of[{sql:'DROP TABLE secret'},{filePath:'secret'},{profile:{password:'secret'}}])expect(()=>validateCommand('query.temporaryRead',{sessionId:'s',taskId:'t',database:'db',table:'table',...extra})).toThrow();expect(()=>validateCommand('query.temporaryCompletion',{sessionId:'s',kind:'columns',database:'db',table:'t',prefix:'',taskId:'not-memory-only'})).toThrow();
  });
});
