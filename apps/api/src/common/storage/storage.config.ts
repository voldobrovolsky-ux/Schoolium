import type { StorageConfig } from './storage.types';

/**
 * Источник конфига хранилища — ENV. Возвращает СТРУКТУРУ (не подключается к S3), поэтому вызов
 * на буте безопасен при пустых ключах. Позже этот источник заменяется на storage_config-таблицу
 * (per-workspace) — сигнатура (→ StorageConfig) остаётся, провайдер не меняется.
 */
export function loadStorageConfigFromEnv(): StorageConfig {
  return {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  };
}

/** Сконфигурирован ли storage (все поля непусты). Пусто → модуль поднимается, но файл-операции падают. */
export function isStorageConfigured(c: StorageConfig): boolean {
  return Boolean(c.endpoint && c.region && c.bucket && c.accessKeyId && c.secretAccessKey);
}
