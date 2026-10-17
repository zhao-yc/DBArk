import { describe, expect, it } from 'vitest';
import type { ServerMonitorSession } from '../../src/shared/serverMonitor';
import { serverMonitorSessionView as view } from '../../src/renderer/serverMonitorSessions';

/** 明确合成字段，不从数据库或既有监控窗口读取。 */
function row(id:string,seconds:string|null='0',patch:Partial<ServerMonitorSession>={}):ServerMonitorSession{return{id,seconds,user:null,host:null,database:null,command:'Query',state:null,sql:null,sqlLength:null,sqlTruncated:false,...patch};}
describe('监控有限会话本地投影',()=>{
  it('超过安全整数和64位边界的相邻ID按精确数字排序，不能按字符串或舍入比较',()=>{
    const rows=['9007199254740993','10','18446744073709551615','2','18446744073709551614','9007199254740992'].map(id=>row(id));
    const expected=['2','10','9007199254740992','9007199254740993','18446744073709551614','18446744073709551615'];expect(view(rows,'','id','asc').rows.map(x=>x.id)).toEqual(expected);expect(view(rows,'','id','desc').rows.map(x=>x.id)).toEqual([...expected].reverse());
  });
  it('持续秒数同样精确，NULL始终末尾，空串与NULL不合并',()=>{
    const rows=[row('a',null),row('b',''),row('c','9007199254740993'),row('d','9007199254740992'),row('e','0')];
    expect(view(rows,'','seconds','asc').rows.map(x=>x.id)).toEqual(['e','d','c','b','a']);expect(view(rows,'','seconds','desc').rows.map(x=>x.id)).toEqual(['c','d','e','b','a']);expect(rows[0].seconds).toBeNull();expect(rows[1].seconds).toBe('');
  });
  it('数值并列/前导零保持原快照顺序，换方向也不反转并列组',()=>{
    const rows=[row('0002','02'),row('2','2'),row('02','0002')];for(const sort of ['id','seconds'] as const)for(const direction of ['asc','desc'] as const)expect(view(rows,'',sort,direction).rows).toEqual(rows);
  });
  it('只对用户/来源/库/状态/已返回SQL摘要作不区分大小写的字面匹配',()=>{
    const rows=[row('1','0',{user:'Alice'}),row('2','0',{host:'来源主机'}),row('3','0',{database:'库名'}),row('4','0',{state:'等待状态'}),row('5','0',{sql:'SELECT 100%_[x]',sqlLength:'9999',sqlTruncated:true})];
    for(const [query,id]of [['alice','1'],['来源','2'],['库名','3'],['等待','4'],['%_[x]','5']])expect(view(rows,query,'id','asc').rows.map(x=>x.id)).toEqual([id]);expect(view(rows,'^SELECT.*','id','asc').filtered).toBe(0);expect(view(rows,'未返回的SQL尾部','id','asc').filtered).toBe(0);expect(view(rows,'Query','id','asc').filtered).toBe(0);
  });
  it('创建新有界数组排序，冻结的原snapshot/行对象不变且不搜索上限外的行',()=>{
    const rows=Object.freeze(Array.from({length:101},(_,index)=>Object.freeze(row(String(101-index),'0',{user:index===100?'只在第101条':'普通'}))));const before=rows.map(x=>x.id),result=view(rows,'','id','asc');expect(result.rows).not.toBe(rows);expect(rows.map(x=>x.id)).toEqual(before);expect(result.filtered).toBe(100);expect(result.returned).toBe(101);expect(result.capped).toBe(true);expect(view(rows,'只在第101条','id','asc').filtered).toBe(0);
  });
  it('NULL不伪造成文字参与搜索，空查询保留NULL与空串原值',()=>{
    const rows=[row('1','0',{user:null}),row('2','0',{user:''}),row('3','0',{user:'NULL'})];expect(view(rows,'NULL','id','asc').rows.map(x=>x.id)).toEqual(['3']);expect(view(rows,'','id','asc').rows.map(x=>x.user)).toEqual([null,'','NULL']);
  });
});
