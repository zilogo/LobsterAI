import type { IPlatformAdapter } from '../../shared/types/platform';

/**
 * ElectronAdapter — 代理 window.electron，零开销透传。
 * 仅在 Electron 环境中使用。
 */
export class ElectronAdapter implements IPlatformAdapter {
  private _electron: typeof window.electron;

  constructor() {
    if (!window.electron) {
      throw new Error('ElectronAdapter: window.electron is not available');
    }
    this._electron = window.electron;
  }

  get platform(): string {
    return this._electron.platform;
  }

  get arch(): string {
    return this._electron.arch;
  }

  get store() {
    return this._electron.store;
  }

  get skills() {
    return this._electron.skills;
  }

  get mcp() {
    return this._electron.mcp;
  }

  get api() {
    return this._electron.api;
  }

  get getApiConfig() {
    return this._electron.getApiConfig.bind(this._electron);
  }

  get checkApiConfig() {
    return this._electron.checkApiConfig.bind(this._electron);
  }

  get saveApiConfig() {
    return this._electron.saveApiConfig.bind(this._electron);
  }

  get generateSessionTitle() {
    return this._electron.generateSessionTitle.bind(this._electron);
  }

  get getRecentCwds() {
    return this._electron.getRecentCwds.bind(this._electron);
  }

  get ipcRenderer() {
    return this._electron.ipcRenderer;
  }

  get window() {
    return this._electron.window;
  }

  get cowork() {
    return this._electron.cowork;
  }

  get files() {
    return this._electron.files;
  }

  get dialog() {
    return this._electron.dialog;
  }

  get shell() {
    return this._electron.shell;
  }

  get autoLaunch() {
    return this._electron.autoLaunch;
  }

  get appInfo() {
    return this._electron.appInfo;
  }

  get appUpdate() {
    return this._electron.appUpdate;
  }

  get log() {
    return this._electron.log;
  }

  get im() {
    return this._electron.im;
  }

  get scheduledTasks() {
    return this._electron.scheduledTasks;
  }

  get permissions() {
    return this._electron.permissions;
  }

  get networkStatus() {
    return this._electron.networkStatus;
  }
}
