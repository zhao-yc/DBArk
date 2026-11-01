import { buildSqliteNative } from '../../scripts/build-sqlite-native.mjs';
import { fileURLToPath } from 'node:url';

/** 测试收集前构建一次，保持原beforeAll与每例超时；不在真实worker启动时运行编译器。 */
export default async function setup() { await buildSqliteNative(fileURLToPath(new URL('../../src/engine/sqlite/sqlite-native/', import.meta.url))); }
