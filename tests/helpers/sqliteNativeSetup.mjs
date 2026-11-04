import { buildSqliteNative } from '../../scripts/build-sqlite-native.mjs';
import { fileURLToPath } from 'node:url';
import { assertNodeSqliteRuntime } from '../../scripts/check-node-runtime.mjs';

/** 测试收集前构建一次，保持原beforeAll与每例超时；不在真实worker启动时运行编译器。 */
export default async function setup() { assertNodeSqliteRuntime(); await buildSqliteNative(fileURLToPath(new URL('../../src/engine/sqlite/sqlite-native/', import.meta.url))); }
