/** 独立Node入口的类型边界，仅描述固定离线环境与命令，不暴露认证或目标参数。 */
export function tableHistogramOfflineEnvironment(parent: Readonly<Record<string, string | undefined>>): { env: Record<string, string>; dropped: string[] };
export function tableHistogramOfflineCommand(): string[];
