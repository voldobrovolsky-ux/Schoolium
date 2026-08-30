/**
 * Живая проверка S3-хранилища: upload-url → PUT тестового файла → headObject → download-url →
 * скачать обратно → удалить. Запуск ПОСЛЕ вписывания ключей: npm run storage:check
 * При пустом .env скрипт не падает — сообщает, что не сконфигурировано.
 */
import { isStorageConfigured, loadStorageConfigFromEnv } from '../src/common/storage/storage.config';
import { S3CompatibleProvider } from '../src/common/storage/s3-compatible.provider';

async function main() {
  const config = loadStorageConfigFromEnv();
  if (!isStorageConfigured(config)) {
    console.log('⚠ S3 не сконфигурирован — впиши S3_* в apps/api/.env и запусти снова.');
    console.log('  (Сервис при пустых ключах поднимается нормально; падает только файловая операция.)');
    return;
  }
  const storage = new S3CompatibleProvider(config); // в приложении config инжектится через DI

  const key = `docs/_storage-check/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const content = `edustore storage check ${new Date().toISOString()}`;
  console.log(`bucket=${config.bucket} endpoint=${config.endpoint}\nkey=${key}\n`);

  const up = await storage.getUploadUrl(key, 'text/plain');
  const put = await fetch(up.url, { method: 'PUT', body: content, headers: { 'Content-Type': 'text/plain' } });
  console.log(`1) upload-url → PUT: ${put.status} ${put.ok ? '✓' : '✗'}`);
  if (!put.ok) { console.log(await put.text()); process.exit(1); }

  const head = await storage.headObject(key);
  console.log(`2) headObject (commit-валидация): ${head.exists ? `есть ✓ (size ${head.size})` : 'НЕ найден ✗'}`);

  const down = await storage.getDownloadUrl(key);
  const get = await fetch(down.url);
  const back = await get.text();
  const match = back === content;
  console.log(`3) download-url → GET: ${get.status} ${match ? 'контент совпал ✓' : '✗ не совпал'}`);

  await storage.deleteObject(key);
  const head2 = await storage.headObject(key);
  console.log(`4) deleteObject: удалён ${!head2.exists ? '✓' : '✗'}`);

  const ok = head.exists && match && !head2.exists;
  console.log(`\n${ok ? '✓ ЖИВОЙ S3 РАБОТАЕТ (upload→commit→download→delete)' : '✗ есть проблема'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('✗', (e as Error).message ?? e);
  process.exit(1);
});
