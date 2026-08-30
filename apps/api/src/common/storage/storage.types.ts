/**
 * Абстракция объектного хранилища (Документохранилище). Весь код файлового модуля обращается
 * к S3 ТОЛЬКО через этот интерфейс — AWS-клиент не размазан по модулю. Реализация одна
 * (S3CompatibleProvider), различие бэкендов (Yandex Object Storage / AWS / MinIO) — только в конфиге.
 */
export interface StorageProvider {
  /** pre-signed PUT для прямой загрузки в S3 (кабинеты не шлют multipart через API). */
  getUploadUrl(key: string, mime: string): Promise<PresignedUrl>;
  /** pre-signed GET для скачивания. */
  getDownloadUrl(key: string): Promise<PresignedUrl>;
  /** HEAD — проверка наличия объекта (для commit: нет объекта → 409). */
  headObject(key: string): Promise<HeadResult>;
  /** чтение объекта целиком (обогащение: экстракция текста учебника). null — объекта нет. */
  getObject(key: string): Promise<Buffer | null>;
  /** удаление объекта. */
  deleteObject(key: string): Promise<void>;
}

export interface PresignedUrl {
  url: string;
  expiresIn: number; // сек
}

export interface HeadResult {
  exists: boolean;
  size?: number;
  contentType?: string;
}

/**
 * Конфиг хранилища — единый объект, который провайдер принимает на вход. Сейчас источник — ENV
 * (loadStorageConfigFromEnv). Позже источник можно заменить на таблицу storage_config (per-workspace)
 * БЕЗ переписывания провайдера — он зависит только от этого типа, не от способа его получения.
 */
export interface StorageConfig {
  endpoint: string; // https://storage.yandexcloud.net
  region: string; // ru-central1
  bucket: string;
  accessKeyId: string; // секрет — только из env/секрет-стора, НИКОГДА в БД/коде
  secretAccessKey: string;
}

// DI-токены (Symbol — без коллизий строк).
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
