/**
 * 集中管理所有业务 API 端点。
 * 后续新增的业务接口也应在此文件中配置。
 */

import { configService } from './config';

const isTestMode = () => {
  return configService.getConfig().app?.testMode === true;
};

// 自动更新
export const getUpdateCheckUrl = () => isTestMode()
  ? ''
  : '';

export const getFallbackDownloadUrl = () => isTestMode()
  ? ''
  : '';

// Skill 商店
export const getSkillStoreUrl = () => isTestMode()
  ? ''
  : '';
