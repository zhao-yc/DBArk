export function sqlSyntaxCheckEnvironment(parent: Record<string, string | undefined>): { env: Record<string, string>; dropped: string[] };
export function sqlSyntaxCheckCommand(): string[];
