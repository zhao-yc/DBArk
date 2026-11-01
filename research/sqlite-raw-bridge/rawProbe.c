/* DBArk自有实验源码，MIT；尚未接入客户端。头文件从固定Node版本下载并核SHA256。
 * 每条原SQL只prepare/step一次；只对step返回SQLITE_ROW后的值副本读取字节。
 * 单值返回BLOB，避免Node在交给JS前已替换无效TEXT；不使用trace回调读列。 */
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1
#include <string.h>
#include <stdint.h>

typedef struct RawProbe { sqlite3 *db; sqlite3_stmt *statement; int done; int row; int result; } RawProbe;

/* 固定提示不泄露SQL、参数或数据库路径。 */
static void invalid(sqlite3_context *ctx) { sqlite3_result_error(ctx,"DBARK_RAW_PROBE_INVALID",-1); }

/* step返回基本码时立即保存本连接扩展码，不能在finalize或下一次控制SQL后再猜。 */
static int failure_code(sqlite3 *db, int rc) {
  int detail=sqlite3_extended_errcode(db);
  return (detail & 255) == (rc & 255) ? detail : rc;
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

/* 0准备原SQL、1推进原游标、2明确收尾、3读列类型及编码、4读列原字节。 */
static void run(sqlite3_context *ctx, int argc, sqlite3_value **args) {
  RawProbe *p = sqlite3_user_data(ctx); int op, rc; sqlite3_int64 operation;
  if (argc != 2 || sqlite3_value_type(args[0]) != SQLITE_INTEGER) { invalid(ctx); return; }
  operation=sqlite3_value_int64(args[0]);
  if (operation < 0 || operation > 4) { invalid(ctx); return; }
  op=(int)operation;
  if (op == 0) {
    const char *tail, *sql; int length;
    if (p->statement || sqlite3_value_type(args[1]) != SQLITE_TEXT) { invalid(ctx); return; }
    sql = (const char *)sqlite3_value_text(args[1]); length = sqlite3_value_bytes(args[1]);
    if (!sql || !length || memchr(sql,0,length)) { invalid(ctx); return; }
    rc = sqlite3_prepare_v3(p->db,sql,length,0,&p->statement,&tail);
    if (rc != SQLITE_OK) { rc=failure_code(p->db,rc); sqlite3_finalize(p->statement); p->statement=0; sqlite3_result_error_code(ctx,rc); return; }
    p->done=0; p->row=0; p->result=SQLITE_OK; sqlite3_result_int(ctx,(int)(tail-sql)); return;
  }
  if (op == 2) {
    if (sqlite3_value_type(args[1]) != SQLITE_NULL) { invalid(ctx); return; }
    rc = sqlite3_finalize(p->statement);
    if (rc != SQLITE_OK) rc = p->done && p->result != SQLITE_DONE ? p->result : failure_code(p->db,rc);
    p->statement=0; p->done=0; p->row=0; p->result=SQLITE_OK;
    if (rc != SQLITE_OK) sqlite3_result_error_code(ctx,rc); else sqlite3_result_int(ctx,0);
    return;
  }
  if (!p->statement) { invalid(ctx); return; }
  if (op == 3 || op == 4) {
    sqlite3_int64 column;
    if (sqlite3_value_type(args[1]) != SQLITE_INTEGER) { invalid(ctx); return; }
    column=sqlite3_value_int64(args[1]);
    if (column < 0 || column >= sqlite3_column_count(p->statement)) { invalid(ctx); return; }
    read_value(ctx,p,op,(int)column); return;
  }
  if (op != 1 || sqlite3_value_type(args[1]) != SQLITE_NULL) { invalid(ctx); return; }
  /* SQLite在DONE后再次step可能自动重跑；桥必须记住终态，不能因此重放写入。 */
  if (p->done) {
    if (p->result == SQLITE_DONE) sqlite3_result_null(ctx); else sqlite3_result_error_code(ctx,p->result);
    return;
  }
  p->row=0; rc=sqlite3_step(p->statement);
  if (rc == SQLITE_ROW) { p->row=1; sqlite3_result_int(ctx,sqlite3_column_count(p->statement)); return; }
  p->done=1; p->result = rc == SQLITE_DONE ? rc : failure_code(p->db,rc);
  if (rc == SQLITE_DONE) sqlite3_result_null(ctx); else sqlite3_result_error_code(ctx,p->result);
}

/* 仅释放准确游标和本连接状态；不保存全局数据库地址，不注册自动加载器。 */
static void destroy(void *raw) { RawProbe *p=raw; if(p->statement) sqlite3_finalize(p->statement); sqlite3_free(p); }
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
