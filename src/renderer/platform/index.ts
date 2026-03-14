import type { IPlatformAdapter } from '../../shared/types/platform';
import { ElectronAdapter } from './ElectronAdapter';
import { WebAdapter } from './WebAdapter';

let adapter: IPlatformAdapter | null = null;

/** 检测当前是否运行在 Electron 环境中 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electron;
}

/** 获取平台适配器单例 */
export function getAdapter(): IPlatformAdapter {
  if (!adapter) {
    adapter = isElectron() ? new ElectronAdapter() : new WebAdapter();
  }
  return adapter;
}

/** 重新导出类型，方便消费方引用 */
export type { IPlatformAdapter };
