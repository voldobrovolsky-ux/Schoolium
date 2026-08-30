import { Global, Module } from '@nestjs/common';
import { STORAGE_CONFIG, STORAGE_PROVIDER } from './storage.types';
import { loadStorageConfigFromEnv } from './storage.config';
import { S3CompatibleProvider } from './s3-compatible.provider';
import { LocalFsProvider } from './local-fs.provider';
import { LocalStorageController } from './local-storage.controller';

const isLocalMode = () => process.env.STORAGE_MODE === 'local';

/**
 * Глобальный storage-модуль. Провайдит:
 *  - STORAGE_CONFIG — из ENV (фабрика читает структуру, к S3 не подключается → бут безопасен);
 *  - STORAGE_PROVIDER — по STORAGE_MODE:
 *      · (пусто, дефолт) — S3CompatibleProvider (Yandex/AWS/MinIO, ленивый клиент);
 *      · local — LocalFsProvider (диск, dev/CI/пилот без S3; транспорт LocalStorageController).
 * Файловый модуль инжектит ТОЛЬКО STORAGE_PROVIDER — смена бэкенда его не касается.
 */
@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    { provide: STORAGE_CONFIG, useFactory: loadStorageConfigFromEnv },
    S3CompatibleProvider,
    LocalFsProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (s3: S3CompatibleProvider, local: LocalFsProvider) => (isLocalMode() ? local : s3),
      inject: [S3CompatibleProvider, LocalFsProvider],
    },
  ],
  exports: [STORAGE_PROVIDER, STORAGE_CONFIG],
})
export class StorageModule {}
