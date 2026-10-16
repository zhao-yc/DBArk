import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { historyAbsoluteEpoch, canonicalHistoryInstant, historyTimeMatches } from '../../src/shared/historyTimeRange';
import { historyPageInputSchema } from '../../src/shared/historyPages';
import { historyLocalInstant, historyInputRange } from '../../src/renderer/historyTimeInput';
import { summarizeHistoryRecord } from '../../src/main/historyPageMatch';
import { validateCommand } from '../../src/shared/validation';
const from='2026-10-17T00:00:00.000Z',until='2026-10-18T00:00:00.000Z';
const request=()=>({taskId:randomUUID(),search:'',fields:['sql' as const],scope:{kind:'all' as const},status:'all' as const,onError:'continue' as const});
describe('历史时间的严格绝对时刻与范围',()=>{
 it('默认无范围保持原协议；新范围只接收规范UTC且拒绝空、相等、倒序与附加参数',()=>{
  expect(historyPageInputSchema.parse(request()).timeRange).toBeUndefined();
  expect(validateCommand('history.page',{...request(),timeRange:{from,until}})).toMatchObject({timeRange:{from,until}});
  for(const timeRange of [{},{from:'2026-10-17T00:00:00Z'},{from:'2026-10-17T08:00:00.000+08:00'},{from:'2026-02-30T00:00:00.000Z'},{from,until:from},{from:until,until:from},{from,inclusive:true}]) expect(()=>historyPageInputSchema.parse({...request(),timeRange})).toThrow();
  expect(()=>validateCommand('history.pageContinue',{taskId:randomUUID(),cursor:randomUUID(),timeRange:{from}})).toThrow();
 });
 it('真实startedAt按绝对时刻比较，开始包含、结束不包含，毫秒保真且偏移等价',()=>{
  expect(historyTimeMatches('2026-10-17T08:00:00+08:00',{from,until})).toBe(true);
  expect(historyTimeMatches('2026-10-16T19:00:00-05:00',{from,until})).toBe(true);
  expect(historyTimeMatches('2026-10-18T08:00:00+08:00',{from,until})).toBe(false);
  expect(historyTimeMatches('2026-10-16T23:59:59.999Z',{from})).toBe(false);
  expect(historyTimeMatches('2026-10-17T00:00:00.125Z',{from:'2026-10-17T00:00:00.125Z',until:'2026-10-17T00:00:00.126Z'})).toBe(true);
  expect(historyAbsoluteEpoch('2026-10-17T08:00:00.1+08:00')).toBe(Date.parse(from)+100);
 });
 it.each(['2026-02-30T00:00:00Z','2026-10-17','2026-10-17T00:00:00','2026-10-17T24:00:00Z','2026-10-17T00:00:60Z','2026-10-17T00:00:00.0001Z','2026-10-17T00:00:00-00:00','2026-10-17T00:00:00+24:00'])('坏或无时区时间%s不能静默归一化',value=>{expect(()=>historyAbsoluteEpoch(value)).toThrow();expect(canonicalHistoryInstant(value)).toBe(false);expect(historyTimeMatches(value)).toBe(true);});
 it('时间无效先于状态与正文筛选报错，错误不回显记录SQL、完整错误或输入',()=>{
  const entry={id:'h',connectionId:'c',sql:'私有SQL尾部',error:'私有错误',startedAt:'遗留秘密时间',elapsedMs:1,success:true},position={id:'h',connectionId:'c',startedAt:entry.startedAt};
  expect(summarizeHistoryRecord('h',JSON.stringify(entry),request(),position)).toBeTruthy();
  expect(()=>summarizeHistoryRecord('h',JSON.stringify(entry),{...request(),status:'failed',search:'不命中',timeRange:{from}},position)).toThrow('绝对时刻');
  try{summarizeHistoryRecord('h',JSON.stringify(entry),{...request(),timeRange:{from}},position);}catch(error){expect(String(error)).not.toMatch(/私有|秘密/);}
 });
});
describe('本机墙钟不静默选择夏令时时刻',()=>{
 it('上海公元一年起点转换落到UTC公元零年时，界面立即拒绝，不构造IPC范围',()=>{
  expect(()=>historyLocalInstant('0001-01-01 00:00','Asia/Shanghai')).toThrow('四位年份范围');
  expect(()=>historyInputRange('0001-01-01 00:00','','Asia/Shanghai')).toThrow('四位年份范围');
  expect(historyLocalInstant('0001-01-01 00:00','UTC')).toBe('0001-01-01T00:00:00.000Z');
 });
 it('固定IANA时区和各端点的实际偏移，保留毫秒，不采用当前偏移',()=>{
  expect(historyLocalInstant('2026-10-17 08:00:00.125','Asia/Shanghai')).toBe('2026-10-17T00:00:00.125Z');
  expect(historyLocalInstant('2024-01-01 12:00','America/New_York')).toBe('2024-01-01T17:00:00.000Z');
  expect(historyLocalInstant('2024-07-01 12:00','America/New_York')).toBe('2024-07-01T16:00:00.000Z');
  expect(historyLocalInstant('0001-01-01 00:00','UTC')).toBe('0001-01-01T00:00:00.000Z');
 });
 it.each([['2024-03-10 02:30','America/New_York'],['2026-10-04 02:15','Australia/Lord_Howe'],['2011-12-30 12:00','Pacific/Apia']])('不存在的%s/%s明确拒绝', (value,zone)=>{expect(()=>historyLocalInstant(value,zone)).toThrow('不存在');});
 it.each([['2024-11-03 01:30','America/New_York'],['2026-04-05 01:45','Australia/Lord_Howe']])('重复的%s/%s不能自动择早', (value,zone)=>{expect(()=>historyLocalInstant(value,zone)).toThrow('重复');});
 it('重复时刻可用明确偏移分别指定；不修改输入，不将空格当清除',()=>{
  expect(historyInputRange('2024-11-03T01:30:00-04:00','2024-11-03T01:30:00-05:00','America/New_York')).toEqual({from:'2024-11-03T05:30:00.000Z',until:'2024-11-03T06:30:00.000Z'});
  expect(historyInputRange('','','Asia/Shanghai')).toBeUndefined();expect(historyInputRange('',until,'')).toEqual({until});
  for(const [a,b]of[[' ', ''],['2026-02-30 08:00',''],['2026-10-17 00:00','2026-10-16 23:00'],['2026-10-17 00:00','2026-10-17 00:00']])expect(()=>historyInputRange(a,b,'Asia/Shanghai')).toThrow();
 });
});
