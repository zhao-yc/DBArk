/** 字段与索引输入共用计量边界，不因新增结构入口放宽单次补丁预算。 */
const limits = { patchBytes: 512 * 1024, patches: 100 } as const;

/** 不调用 getter/toJSON；逐项检查自有数据描述符并累计 JSON 转义后的 UTF-8 字节。 */
export function inspectStructurePatchInput(input: unknown, label: string): { value: unknown; bytes: number } {
  let bytes = 0, nodes = 0;
  const ancestors = new WeakSet<object>();
  const fail = (message: string): never => { throw new Error(label + message); };
  const charge = (size: number): void => { bytes += size; if (bytes > limits.patchBytes) fail('超过 512 KiB'); };
  /** 按 Unicode 码点计算转义成本，不先分配可能巨大的 JSON 字符串。 */
  const string = (value: string): void => {
    if (value.length + 2 > limits.patchBytes - bytes) fail('超过 512 KiB');
    charge(2);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail('含非法 Unicode');
        charge(4);
      } else if (code >= 0xdc00 && code <= 0xdfff) fail('含非法 Unicode');
      else if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) charge(2);
      else charge(code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : 3);
    }
  };
  /** 容器、节点及嵌套分别有上限，循环和非普通对象不属于可传输补丁。 */
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 8) fail('结构超出预算');
    if (typeof value === 'string') { string(value); return value; }
    if (value === null) { charge(4); return value; }
    if (typeof value === 'boolean') { charge(value ? 4 : 5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { charge(String(value).length); return value; }
    if (!value || typeof value !== 'object') return fail('包含非法值');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail('只接受普通对象和数组');
    if (ancestors.has(value)) fail('不接受循环引用');
    ancestors.add(value); charge(2);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number;
        if (length > (depth === 0 ? limits.patches : 65535)) fail('数组超出数量范围');
        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) fail('数组必须连续且不能含额外字段');
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('不接受访问器或稀疏数组');
          if (index) charge(1);
          result.push(visit(descriptor!.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null); let count = 0;
      for (const key of Reflect.ownKeys(value)) {
        if (++count > 16) fail('对象字段过多');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('只接受自有可枚举数据字段');
        if (count > 1) charge(1);
        string(key as string); charge(1); result[key as string] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  if (!Array.isArray(input)) fail('必须为数组');
  return { value: visit(input, 0), bytes };
}
