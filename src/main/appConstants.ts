import brandConfig from '../../brand.config.json';

export const APP_NAME = brandConfig.appName;
export const APP_ID = brandConfig.appId;
export const DB_FILENAME = `${brandConfig.appId}.sqlite`;

/** Web 模式下 userData 的 fallback 目录名 (e.g. '.assistant') */
export const USER_DATA_DIR_NAME = `.${APP_ID}`;
