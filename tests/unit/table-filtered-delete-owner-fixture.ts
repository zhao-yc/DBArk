import { TableFilteredDeleteOwners } from '../../src/main/tableFilteredDeleteOwners';

/** 旧用途未打开删除能力时提供真实空协调器；不以 noop 授权或伪造清理新任务。 */
export function emptyTableFilteredDeleteOwners(): TableFilteredDeleteOwners {
  const deny = (): never => { throw Error('本夹具未授权全部筛选行删除用途'); };
  return new TableFilteredDeleteOwners({
    assert: deny, same: deny, revision: deny, closing: deny, available: deny,
    run: async () => deny(), release: async () => deny(), stop: async () => deny(),
  });
}
