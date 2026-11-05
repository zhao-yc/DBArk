import { z } from 'zod';

export const postgresRoleKey = z.string().regex(/^[1-9][0-9]{0,9}$/);
export const postgresTargetSearch = z.string().max(256).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
export type PostgresTargetChoices = { choices: { key: string; label: string }[]; limited: boolean };
