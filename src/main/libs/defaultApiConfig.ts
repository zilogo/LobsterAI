/**
 * Default API configuration — 从环境变量读取，供 Web 模式开箱即用。
 *
 * 环境变量:
 *   DEFAULT_API_ENABLED       - 是否启用 (true/false)
 *   DEFAULT_API_KEY           - 真实 API Key (仅后端使用，不暴露给前端)
 *   DEFAULT_API_BASE_URL      - API 基础 URL
 *   DEFAULT_API_MODELS        - 模型列表 JSON 数组
 *   DEFAULT_API_DEFAULT_MODEL - 默认模型 ID
 *   DEFAULT_API_FORMAT        - API 协议 (anthropic/openai)
 */

export const DEFAULT_API_KEY_PLACEHOLDER = '__DEFAULT__';

export interface DefaultApiModel {
  id: string;
  name: string;
  supportsImage?: boolean;
}

export interface DefaultApiConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  models: DefaultApiModel[];
  defaultModel: string;
  apiFormat: 'anthropic' | 'openai';
}

export interface DefaultApiPublicInfo {
  enabled: boolean;
  baseUrl: string;
  models: DefaultApiModel[];
  defaultModel: string;
  apiFormat: 'anthropic' | 'openai';
  providerName: string;
}

function parseModels(raw: string | undefined): DefaultApiModel[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: any) => typeof m?.id === 'string' && typeof m?.name === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * 完整配置（含 Key）— 仅后端内部使用
 */
export function getDefaultApiConfig(): DefaultApiConfig | null {
  if (process.env.DEFAULT_API_ENABLED !== 'true') return null;

  const apiKey = process.env.DEFAULT_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = process.env.DEFAULT_API_BASE_URL?.trim();
  if (!baseUrl) return null;

  const models = parseModels(process.env.DEFAULT_API_MODELS);
  const defaultModel = process.env.DEFAULT_API_DEFAULT_MODEL?.trim() || models[0]?.id || '';
  const format = process.env.DEFAULT_API_FORMAT?.trim();
  const apiFormat: 'anthropic' | 'openai' = format === 'openai' ? 'openai' : 'anthropic';

  return { enabled: true, apiKey, baseUrl, models, defaultModel, apiFormat };
}

/**
 * 公开信息（无 Key）— 供前端 GET /api/config/default-api 使用
 */
export function getDefaultApiPublicInfo(): DefaultApiPublicInfo | null {
  const config = getDefaultApiConfig();
  if (!config) return null;

  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    models: config.models,
    defaultModel: config.defaultModel,
    apiFormat: config.apiFormat,
    providerName: 'anthropic',
  };
}

/**
 * 判断给定 key 是否为占位符
 */
export function isDefaultApiKeyPlaceholder(key: string | undefined | null): boolean {
  return key === DEFAULT_API_KEY_PLACEHOLDER;
}

/**
 * 如果是占位符则返回真实 Key，否则原样返回
 */
export function resolveDefaultApiKey(key: string): string {
  if (key !== DEFAULT_API_KEY_PLACEHOLDER) return key;
  const config = getDefaultApiConfig();
  return config?.apiKey || key;
}
