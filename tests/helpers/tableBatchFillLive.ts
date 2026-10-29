type Environment = Record<string, string | undefined>;
export const batchFillCaseNames = [
  '批量填充：两条已有行暂存不写库，一步撤销重做后集中提交且精确旁列保持',
  '批量填充：预览后第二行外改导致整批冲突回滚，草稿保留且不自动重放',
  '批量填充：四字段统一值一步暂存撤销重做，精确集中提交且控制行保持',
  '批量填充：四字段预览后旁列外改，整组事务回滚且草稿保留',
] as const;
export const batchFillTargetKeys = [
  'DBARK_INTEGRATION_ENABLED', 'DBARK_D02_BATCH_FILL_UI', 'DBARK_BATCH_FILL_SERVER_VERIFIED',
  'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID',
  'DBARK_TEST_DATABASE', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'DBARK_DEV_URL', 'DBARK_EXECUTABLE_PATH',
] as const;

/** 只认本轮显式自有字符串；不读取文件，也不把访问器或原型默认值当作许可。 */
function snapshot(environment: Environment) {
  return batchFillTargetKeys.map(key => {
    const property = Object.getOwnPropertyDescriptor(environment, key);
    if (property && (!Object.hasOwn(property, 'value') || typeof property.value !== 'string')) throw Error('批量填充参数必须为显式自有字符串');
    return { key, present: !!property, value: property?.value as string | undefined };
  });
}

/** 目标绑定不接受旧.env回填；观察到漂移后，即使恢复原值也永久拒绝本次运行。 */
export function bindBatchFillTarget(read: () => Environment) {
  const fixed = snapshot(read()), take = (key: typeof batchFillTargetKeys[number]) => fixed.find(item => item.key === key)!;
  const value = (key: typeof batchFillTargetKeys[number]) => take(key).value;
  if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_D02_BATCH_FILL_UI') !== '1' || value('DBARK_BATCH_FILL_SERVER_VERIFIED') !== '1'
    || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0'
    || !value('DBARK_TEST_USER') || !take('DBARK_TEST_PASSWORD').present || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value('DBARK_TEST_EXPECTED_SERVER_UUID') ?? '')
    || ['DBARK_TEST_DATABASE', 'DBARK_TEST_CA', 'DBARK_DEV_URL', 'DBARK_EXECUTABLE_PATH'].some(key => take(key as typeof batchFillTargetKeys[number]).present)
    || ![undefined, '0'].includes(value('DBARK_TEST_SSH'))) throw Error('批量填充仅允许本轮已核200/13384、显式凭据及随机隔离库源模式');
  let invalid = false;
  const assert = (environment: Environment) => {
    if (invalid) throw Error('批量填充目标已失效，保留现场');
    try { if (JSON.stringify(snapshot(environment)) !== JSON.stringify(fixed)) throw Error('漂移'); }
    catch { invalid = true; throw Error('批量填充目标已失效，保留现场'); }
  };
  return {
    target: Object.freeze({ host: value('DBARK_TEST_HOST')!, port: 13384, user: value('DBARK_TEST_USER')!, password: value('DBARK_TEST_PASSWORD')!, uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID')! }),
    assertCurrent() { assert(read()); },
    assertHelper(environment: Environment) { assert(read()); assert(environment); },
  };
}
export type BatchFillTarget = ReturnType<typeof bindBatchFillTarget>;

interface TestClock { readonly _startWallTime?: number; readonly timeout: number; readonly status?: string; }
/** 沿正式fixture的原TestInfo起点计时；晚目录、超时或失败恢复不能重置准备期限。 */
export class BatchFillPreparation {
  private readonly start: number; private last: number; private invalid = false;
  constructor(private readonly info: TestClock, private readonly now = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.last = this.start; }
  assertCurrent(): void {
    try {
      const current = this.now();
      if (this.invalid || !Number.isFinite(this.start) || this.start < 0 || this.info._startWallTime !== this.start || this.info.timeout !== 120000 || this.info.status !== 'passed'
        || !Number.isFinite(current) || current < this.last || current >= this.start + 120000) throw Error('准备失效');
      this.last = current;
    } catch { this.invalid = true; throw Error('批量填充原TestInfo或准备期限已失效，保留现场'); }
  }
}
