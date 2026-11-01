/* DBArk自有实验源码，MIT；尚未接入客户端。头文件从固定Node版本下载并核SHA256。
 * 每条原SQL只prepare/step一次；只对step返回SQLITE_ROW后的值副本读取字节。
 * 单值返回BLOB，避免Node在交给JS前已替换无效TEXT；不使用trace回调读列。 */
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1
#include <string.h>
#include <stdint.h>

#define RAW_SQL_BYTES (20*1024*1024)
#define RAW_SQL_CHUNK 65536
typedef struct RawProbe {
  sqlite3 *db; sqlite3_stmt *statement; int done; int row; int result; int started; int bind_index;
  unsigned char *sql; int sql_length; int sql_capacity; int sql_stage; int consumed;
} RawProbe;

/* 固定提示不泄露SQL、参数或数据库路径。 */
static void invalid(sqlite3_context *ctx) { sqlite3_result_error(ctx,"DBARK_RAW_PROBE_INVALID",-1); }

/* step返回基本码时立即保存本连接扩展码，不能在finalize或下一次控制SQL后再猜。 */
static int failure_code(sqlite3 *db, int rc) {
  int detail=sqlite3_extended_errcode(db);
  return (detail & 255) == (rc & 255) ? detail : rc;
}

/* 完整UTF8到齐后一次核验；分段边界允许落在多字节字符内部，禁止NUL及无效Unicode。 */
static int valid_sql(const unsigned char *bytes, int length) {
  int i=0;
  while (i<length) {
    uint32_t code, minimum; int follow, j; unsigned char first=bytes[i++];
    if (first<128) { if (!first) return 0; continue; }
    if (first>=194 && first<=223) { code=first&31; follow=1; minimum=128; }
    else if (first>=224 && first<=239) { code=first&15; follow=2; minimum=2048; }
    else if (first>=240 && first<=244) { code=first&7; follow=3; minimum=65536; }
    else return 0;
    if (follow>length-i) return 0;
    for (j=0;j<follow;j++) { unsigned char next=bytes[i++]; if ((next&192)!=128) return 0; code=(code<<6)|(next&63); }
    if (code<minimum || code>1114111 || (code>=55296 && code<=57343)) return 0;
  }
  return 1;
}

/* 释放本轮SQL材料与阶段；只在原statement明确finalize后调用。 */
static void clear_source(RawProbe *p) {
  sqlite3_free(p->sql); p->sql=0; p->sql_length=0; p->sql_capacity=0; p->sql_stage=0; p->consumed=0;
  p->done=0; p->row=0; p->result=SQLITE_OK; p->started=0; p->bind_index=0;
}

/* 缓冲上限固定20MiB，扩容失败保留原材料，调用方须明确放弃；不触发prepare或step。 */
static int append_sql(sqlite3_context *ctx, RawProbe *p, const void *bytes, int count) {
  int needed, capacity; unsigned char *next;
  if (!bytes || count<=0 || p->sql_length>RAW_SQL_BYTES-count) { invalid(ctx); return 0; }
  needed=p->sql_length+count; capacity=p->sql_capacity;
  if (capacity<needed) {
    if (!capacity) capacity=RAW_SQL_CHUNK;
    while (capacity<needed) capacity=capacity>RAW_SQL_BYTES/2 ? RAW_SQL_BYTES : capacity*2;
    next=sqlite3_realloc64(p->sql,(sqlite3_uint64)capacity+1);
    if (!next) { sqlite3_result_error_nomem(ctx); return 0; }
    p->sql=next; p->sql_capacity=capacity;
  }
  memcpy(p->sql+p->sql_length,bytes,count); p->sql_length=needed; p->sql[needed]=0; return 1;
}

/* 原生tail只认第一条完整语句；不扫描或改写trigger内部的分号。 */
static void prepare_source(sqlite3_context *ctx, RawProbe *p) {
  const char *tail; int rc;
  if (p->sql_stage!=1 || !p->sql_length || !valid_sql(p->sql,p->sql_length)) { invalid(ctx); return; }
  rc=sqlite3_prepare_v3(p->db,(const char *)p->sql,p->sql_length,0,&p->statement,&tail);
  if (rc!=SQLITE_OK) { rc=failure_code(p->db,rc); sqlite3_finalize(p->statement); p->statement=0; clear_source(p); sqlite3_result_error_code(ctx,rc); return; }
  p->sql_stage=2; p->consumed=(int)(tail-(const char *)p->sql);
  sqlite3_result_int(ctx,p->consumed);
}

/* 元数据始终来自当前原生statement；NULL与空字符串分开，UTF8原字节由JS严格解码。 */
static void metadata(sqlite3_context *ctx, RawProbe *p, sqlite3_int64 selector) {
  const char *text=0; unsigned int column=(unsigned int)(selector&UINT64_C(0xffffffff));
  sqlite3_int64 field=selector>>32;
  if (selector<0 || field>4 || column>=(unsigned int)sqlite3_column_count(p->statement)) { invalid(ctx); return; }
  if (field==0) text=sqlite3_column_name(p->statement,(int)column);
  else if (field==1 && sqlite3_api->column_database_name) text=sqlite3_column_database_name(p->statement,(int)column);
  else if (field==2 && sqlite3_api->column_table_name) text=sqlite3_column_table_name(p->statement,(int)column);
  else if (field==3 && sqlite3_api->column_origin_name) text=sqlite3_column_origin_name(p->statement,(int)column);
  else if (field==4) text=sqlite3_column_decltype(p->statement,(int)column);
  else { invalid(ctx); return; }
  if (text) sqlite3_result_blob(ctx,text,(int)strlen(text),SQLITE_TRANSIENT); else sqlite3_result_null(ctx);
}

/* 对独立值副本取原编码，禁止为读取字节改变原statement中的存储类型。 */
static void read_value(sqlite3_context *ctx, RawProbe *p, int op, int column) {
  sqlite3_value *copy; int type, encoding; const void *bytes; int count;
  if (!p->row || column < 0 || column >= sqlite3_column_count(p->statement)) { invalid(ctx); return; }
  copy = sqlite3_value_dup(sqlite3_column_value(p->statement,column));
  if (!copy) { sqlite3_result_error_nomem(ctx); return; }
  type = sqlite3_value_type(copy); encoding = type == SQLITE_TEXT ? sqlite3_value_encoding(copy) : 0;
  if (op == 3) sqlite3_result_int(ctx,type | (encoding << 8));
  else if (type == SQLITE_INTEGER || type == SQLITE_FLOAT) {
    uint64_t bits; unsigned char output[8]; int i;
    if (type == SQLITE_INTEGER) bits = (uint64_t)sqlite3_value_int64(copy);
    else { double number = sqlite3_value_double(copy); memcpy(&bits,&number,8); }
    for (i=0;i<8;i++) output[i] = (unsigned char)(bits >> (i*8));
    sqlite3_result_blob(ctx,output,8,SQLITE_TRANSIENT);
  } else if (type == SQLITE_NULL) sqlite3_result_blob(ctx,"",0,SQLITE_STATIC);
  else if (type == SQLITE_TEXT || type == SQLITE_BLOB) {
    bytes = sqlite3_value_blob(copy); count = sqlite3_value_bytes(copy);
    if (count && !bytes) sqlite3_result_error_nomem(ctx);
    else sqlite3_result_blob(ctx,count ? bytes : "",count,SQLITE_TRANSIENT);
  } else invalid(ctx);
  sqlite3_value_free(copy);
}

/* 0直接准备、1推进、2收尾、3/4读值；5～11参数/元数据/原前缀，12～14分段SQL，15真实statement位。 */
static void run(sqlite3_context *ctx, int argc, sqlite3_value **args) {
  RawProbe *p = sqlite3_user_data(ctx); int op, rc; sqlite3_int64 operation;
  if (argc != 2 || sqlite3_value_type(args[0]) != SQLITE_INTEGER) { invalid(ctx); return; }
  operation=sqlite3_value_int64(args[0]);
  if (operation < 0 || operation > 15) { invalid(ctx); return; }
  op=(int)operation;
  if (op == 0) {
    const char *sql; int length;
    if (p->sql_stage || sqlite3_value_type(args[1])!=SQLITE_TEXT) { invalid(ctx); return; }
    sql=(const char *)sqlite3_value_text(args[1]); length=sqlite3_value_bytes(args[1]);
    p->sql_stage=1;
    if (!append_sql(ctx,p,sql,length)) { clear_source(p); return; }
    prepare_source(ctx,p); return;
  }
  if (op == 2) {
    if (sqlite3_value_type(args[1]) != SQLITE_NULL) { invalid(ctx); return; }
    rc = sqlite3_finalize(p->statement);
    if (rc != SQLITE_OK) rc = p->done && p->result != SQLITE_DONE ? p->result : failure_code(p->db,rc);
    p->statement=0; clear_source(p);
    if (rc != SQLITE_OK) sqlite3_result_error_code(ctx,rc); else sqlite3_result_int(ctx,0);
    return;
  }
  if (op==12) {
    if (p->sql_stage || sqlite3_value_type(args[1])!=SQLITE_NULL) { invalid(ctx); return; }
    p->sql_stage=1; sqlite3_result_int(ctx,0); return;
  }
  if (op==13) {
    const void *bytes; int count;
    if (p->sql_stage!=1 || sqlite3_value_type(args[1])!=SQLITE_BLOB) { invalid(ctx); return; }
    bytes=sqlite3_value_blob(args[1]); count=sqlite3_value_bytes(args[1]);
    if (count>RAW_SQL_CHUNK) { invalid(ctx); return; }
    if (append_sql(ctx,p,bytes,count)) sqlite3_result_int(ctx,p->sql_length);
    return;
  }
  if (op==14) { if (sqlite3_value_type(args[1])!=SQLITE_NULL) invalid(ctx); else prepare_source(ctx,p); return; }
  if (p->sql_stage!=2) { invalid(ctx); return; }
  if (op==11) {
    sqlite3_int64 offset; int count;
    if (sqlite3_value_type(args[1])!=SQLITE_INTEGER) { invalid(ctx); return; }
    offset=sqlite3_value_int64(args[1]); if (offset<0 || offset>p->consumed) { invalid(ctx); return; }
    count=p->consumed-(int)offset; if (count>RAW_SQL_CHUNK) count=RAW_SQL_CHUNK;
    sqlite3_result_blob(ctx,p->sql+(int)offset,count,SQLITE_TRANSIENT); return;
  }
  if (op==5 || op==10 || op==15) {
    if (sqlite3_value_type(args[1])!=SQLITE_NULL) { invalid(ctx); return; }
    sqlite3_result_int(ctx,op==15 ? p->statement!=0 : !p->statement ? 0 : op==5 ? sqlite3_bind_parameter_count(p->statement) : sqlite3_column_count(p->statement)); return;
  }
  if (!p->statement) {
    if (op==1 && sqlite3_value_type(args[1])==SQLITE_NULL) sqlite3_result_null(ctx); else invalid(ctx);
    return;
  }
  if (op==6 || op==8) {
    sqlite3_int64 index;
    if (op==6) p->bind_index=0;
    if (sqlite3_value_type(args[1])!=SQLITE_INTEGER || (op==6 && p->started)) { invalid(ctx); return; }
    index=sqlite3_value_int64(args[1]);
    if (index<1 || index>sqlite3_bind_parameter_count(p->statement)) { invalid(ctx); return; }
    if (op==6) { p->bind_index=(int)index; sqlite3_result_int(ctx,0); }
    else { const char *name=sqlite3_bind_parameter_name(p->statement,(int)index); if(name) sqlite3_result_blob(ctx,name,(int)strlen(name),SQLITE_TRANSIENT); else sqlite3_result_null(ctx); }
    return;
  }
  if (op==7) {
    int index=p->bind_index; p->bind_index=0;
    if (p->started || !index) { invalid(ctx); return; }
    /* UTF16库中的函数参数可能已转为UTF16；bind_value再次绑定会把真实BOM当编码标记剥离。
     * 与Node原入口一致，TEXT明确以UTF8及准确长度绑定，其余类型按原生存储值复制。 */
    if (sqlite3_value_type(args[1])==SQLITE_TEXT) {
      const unsigned char *utf8=sqlite3_value_text(args[1]); int count=sqlite3_value_bytes(args[1]);
      if (!utf8) { sqlite3_result_error_nomem(ctx); return; }
      rc=sqlite3_bind_text64(p->statement,index,(const char *)utf8,(sqlite3_uint64)count,SQLITE_TRANSIENT,SQLITE_UTF8);
    } else rc=sqlite3_bind_value(p->statement,index,args[1]);
    if (rc!=SQLITE_OK) sqlite3_result_error_code(ctx,failure_code(p->db,rc)); else sqlite3_result_int(ctx,0);
    return;
  }
  if (op==9) { if(sqlite3_value_type(args[1])!=SQLITE_INTEGER) invalid(ctx); else metadata(ctx,p,sqlite3_value_int64(args[1])); return; }
  if (op == 3 || op == 4) {
    sqlite3_int64 column;
    if (sqlite3_value_type(args[1]) != SQLITE_INTEGER) { invalid(ctx); return; }
    column=sqlite3_value_int64(args[1]);
    if (column < 0 || column >= sqlite3_column_count(p->statement)) { invalid(ctx); return; }
    read_value(ctx,p,op,(int)column); return;
  }
  if (op != 1 || sqlite3_value_type(args[1]) != SQLITE_NULL || p->bind_index) { invalid(ctx); return; }
  /* SQLite在DONE后再次step可能自动重跑；桥必须记住终态，不能因此重放写入。 */
  if (p->done) {
    if (p->result == SQLITE_DONE) sqlite3_result_null(ctx); else sqlite3_result_error_code(ctx,p->result);
    return;
  }
  p->row=0; p->started=1; rc=sqlite3_step(p->statement);
  if (rc == SQLITE_ROW) { p->row=1; sqlite3_result_int(ctx,sqlite3_column_count(p->statement)); return; }
  p->done=1; p->result = rc == SQLITE_DONE ? rc : failure_code(p->db,rc);
  if (rc == SQLITE_DONE) sqlite3_result_null(ctx); else sqlite3_result_error_code(ctx,p->result);
}

/* 仅释放准确游标和本连接状态；不保存全局数据库地址，不注册自动加载器。 */
static void destroy(void *raw) { RawProbe *p=raw; if(p->statement) sqlite3_finalize(p->statement); clear_source(p); sqlite3_free(p); }
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_dbarkrawprobe_init(sqlite3 *db, char **error, const sqlite3_api_routines *api) {
  RawProbe *p; SQLITE_EXTENSION_INIT2(api);
  (void)error;
  if (sqlite3_libversion_number() < 3040000 || sizeof(double) != 8 || sizeof(uint64_t) != 8) return SQLITE_ERROR;
  p=sqlite3_malloc(sizeof(RawProbe)); if(!p) return SQLITE_NOMEM;
  memset(p,0,sizeof(RawProbe)); p->db=db;
  return sqlite3_create_function_v2(db,"dbark_raw_probe_v1",2,SQLITE_UTF8|SQLITE_DIRECTONLY,p,run,0,0,destroy);
}
