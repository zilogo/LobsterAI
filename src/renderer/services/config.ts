import { AppConfig, CONFIG_KEYS, defaultConfig } from '../config';
import { localStore } from './store';

const getFixedProviderApiFormat = (providerKey: string): 'anthropic' | 'openai' | null => {
  if (providerKey === 'openai' || providerKey === 'gemini' || providerKey === 'stepfun' || providerKey === 'youdaozhiyun') {
    return 'openai';
  }
  if (providerKey === 'anthropic') {
    return 'anthropic';
  }
  return null;
};

const normalizeProviderBaseUrl = (providerKey: string, baseUrl: unknown): string => {
  if (typeof baseUrl !== 'string') {
    return '';
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (providerKey !== 'gemini') {
    return normalized;
  }

  if (!normalized || !normalized.includes('generativelanguage.googleapis.com')) {
    return normalized;
  }

  if (normalized.endsWith('/v1beta/openai') || normalized.endsWith('/v1/openai')) {
    return normalized;
  }
  if (normalized.endsWith('/v1beta')) {
    return `${normalized}/openai`;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized.slice(0, -3)}v1beta/openai`;
  }

  return 'https://generativelanguage.googleapis.com/v1beta/openai';
};

const normalizeProviderApiFormat = (providerKey: string, apiFormat: unknown): 'anthropic' | 'openai' => {
  const fixed = getFixedProviderApiFormat(providerKey);
  if (fixed) {
    return fixed;
  }
  if (apiFormat === 'openai') {
    return 'openai';
  }
  return 'anthropic';
};

const normalizeProvidersConfig = (providers: AppConfig['providers']): AppConfig['providers'] => {
  if (!providers) {
    return providers;
  }

  return Object.fromEntries(
    Object.entries(providers).map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        baseUrl: normalizeProviderBaseUrl(providerKey, providerConfig.baseUrl),
        apiFormat: normalizeProviderApiFormat(providerKey, providerConfig.apiFormat),
      },
    ])
  ) as AppConfig['providers'];
};

const DEFAULT_API_KEY_PLACEHOLDER = '__DEFAULT__';

export interface DefaultApiInfo {
  enabled: boolean;
  baseUrl: string;
  models: Array<{ id: string; name: string; supportsImage?: boolean }>;
  defaultModel: string;
  apiFormat: 'anthropic' | 'openai';
  providerName: string;
}

class ConfigService {
  private config: AppConfig = defaultConfig;

  async init() {
    try {
      const storedConfig = await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG);
      if (storedConfig) {
        const mergedProviders = storedConfig.providers
          ? Object.fromEntries(
              Object.entries({
                ...(defaultConfig.providers ?? {}),
                ...storedConfig.providers,
              }).map(([providerKey, providerConfig]) => [
                providerKey,
                (() => {
                  const mergedProvider = {
                    ...(defaultConfig.providers as Record<string, any>)?.[providerKey],
                    ...providerConfig,
                  };
                  return {
                    ...mergedProvider,
                    baseUrl: normalizeProviderBaseUrl(providerKey, mergedProvider.baseUrl),
                    apiFormat: normalizeProviderApiFormat(providerKey, mergedProvider.apiFormat),
                  };
                })(),
              ])
            )
          : defaultConfig.providers;

        this.config = {
          ...defaultConfig,
          ...storedConfig,
          api: {
            ...defaultConfig.api,
            ...storedConfig.api,
          },
          model: {
            ...defaultConfig.model,
            ...storedConfig.model,
          },
          app: {
            ...defaultConfig.app,
            ...storedConfig.app,
          },
          shortcuts: {
            ...defaultConfig.shortcuts!,
            ...(storedConfig.shortcuts ?? {}),
          } as AppConfig['shortcuts'],
          providers: mergedProviders as AppConfig['providers'],
        };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  getConfig(): AppConfig {
    return this.config;
  }

  /**
   * 注入默认 API 到内存配置（不持久化）。
   * 将 anthropic provider 设置为 enabled，apiKey='__DEFAULT__'，
   * models 和 baseUrl 从服务端 info 获取。
   */
  injectDefaultApi(info: DefaultApiInfo): void {
    if (!info.enabled || !this.config.providers) return;

    const providerKey = info.providerName || 'anthropic';
    const existing = this.config.providers[providerKey];
    if (!existing) return;

    this.config = {
      ...this.config,
      providers: {
        ...this.config.providers,
        [providerKey]: {
          ...existing,
          enabled: true,
          apiKey: DEFAULT_API_KEY_PLACEHOLDER,
          baseUrl: info.baseUrl,
          apiFormat: info.apiFormat,
          models: info.models.map((m) => ({
            id: m.id,
            name: m.name,
            supportsImage: m.supportsImage,
          })),
        },
      },
      model: {
        ...this.config.model,
        defaultModel: info.defaultModel,
        defaultModelProvider: providerKey,
      },
    };
  }

  async updateConfig(newConfig: Partial<AppConfig>) {
    const normalizedProviders = normalizeProvidersConfig(newConfig.providers as AppConfig['providers'] | undefined);

    // 更新内存配置（保留 __DEFAULT__ 占位符，仅在持久化时过滤）
    this.config = {
      ...this.config,
      ...newConfig,
      ...(normalizedProviders ? { providers: normalizedProviders } : {}),
    };

    // 持久化时过滤 __DEFAULT__，防止占位符泄漏到 SQLite
    const configToStore = { ...this.config };
    if (configToStore.providers) {
      configToStore.providers = Object.fromEntries(
        Object.entries(configToStore.providers).map(([key, config]) => [
          key,
          {
            ...config,
            apiKey: config.apiKey === DEFAULT_API_KEY_PLACEHOLDER ? '' : config.apiKey,
          },
        ])
      ) as AppConfig['providers'];
    }
    await localStore.setItem(CONFIG_KEYS.APP_CONFIG, configToStore);
  }

  getApiConfig() {
    return {
      apiKey: this.config.api.key,
      baseUrl: this.config.api.baseUrl,
    };
  }
}

export const configService = new ConfigService(); 
