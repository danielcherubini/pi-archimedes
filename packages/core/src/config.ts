import { loadConfig, saveConfig } from "./settings-io.js";

export interface CoreConfig {}
export const DEFAULT_CORE_CONFIG: CoreConfig = {};
export function loadCoreConfig(): CoreConfig { return {}; }
export function saveCoreConfig(_config: CoreConfig): void {}
