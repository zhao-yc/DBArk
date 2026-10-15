import{describe,it,expect}from'vitest';
import{sessionObjectIdentity}from'../../src/engine/sessionObjectRead';
describe('会话对象的服务器定义身份',()=>{
  it.each(['CREATE TEMPORARY TABLE `subject`(id INT)','create temporary table "subject" (id INT)','CREATE OR REPLACE TEMPORARY TABLE subject(id INT)'])('确认临时定义：%s',definition=>{expect(sessionObjectIdentity({'Create Table':definition})).toBe('temporary');});
  it('永久表与视图各自确认，定义中的函数或临时关键词不影响身份',()=>{
    expect(sessionObjectIdentity({'Create Table':"CREATE TABLE `subject`(value TEXT COMMENT 'TEMPORARY')"})).toBe('table');
    expect(sessionObjectIdentity({'Create View':'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW v AS SELECT effect()'})).toBe('view');
  });
  it.each([{}, {'Create View':null},{'Create Table':'CREATE VIEW v AS SELECT 1'},{'Create View':'SELECT 1'},{'Create Table':'CREATE TABLE t(id INT)','Create View':'CREATE VIEW v AS SELECT 1'}])('未知或冲突身份不能确认不存在：%j',row=>{expect(()=>sessionObjectIdentity(row)).toThrow();});
});
