import { TableFilteredUpdateOwners } from '../../src/main/tableFilteredUpdateOwners';

/** 旧用途未打开全部筛选行填充时，提供真实空协调器；不得借夹具获得新用途授权。 */
export function emptyTableFilteredUpdateOwners(): TableFilteredUpdateOwners {
  const deny = (): never => { throw Error('本夹具未授权全部筛选行填充用途'); };
  return new TableFilteredUpdateOwners({
    assert: deny, same: deny, revision: deny, closing: deny, available: deny,
    run: async () => deny(), release: async () => deny(), stop: async () => deny(),
  });
}
