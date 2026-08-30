/**
 * G-10 (AR-35) — полнота RBAC перечислением, не глазами.
 * Обходит ВСЕ контроллеры приложения через ModulesContainer и для каждого мутационного
 * роута (POST/PUT/PATCH/DELETE) требует одно из:
 *   1) @RequirePermission(code) — код обязан существовать в каталоге и входить в ≥1 пакет;
 *   2) явную строку в WHITELIST с причиной (resource-gated / key-gated / identity-gated).
 * Любая незагейченная мутация вне whitelist = провал. Новый роут без решения о гейте
 * не пройдёт CI — прирост охвата без прироста полноты невозможен.
 * Запуск: npm run authz:check  (нужен поднятый Postgres — контекст Nest реальный).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module';
import { REQUIRE_PERMISSION } from '../src/common/authz/require-permission.decorator';
import { IS_PUBLIC } from '../src/common/auth/public.decorator';
import { PERMISSIONS, ROLE_PACKAGES } from '../src/common/authz/catalog';

const MUTATIONS = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);
const M = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

/**
 * Осознанные исключения — каждая строка с причиной. Ключ: `Controller.method`.
 * resource-gated — право проверяется на уровне ресурса в сервисе (модератор канала,
 *   участник, адресат ack) — роль тут не критерий;
 * identity-gated — действие над собственной сессией/устройством;
 * key-gated — временный пилотный контур (AR-15) либо одноразовый storage-токен;
 * oidc-spec — публичный эндпоинт по спецификации OIDC.
 */
const WHITELIST: Record<string, string> = {
  // Communitoria: инварианты и права — resource-level в ChannelService/MessageService
  'ChannelController.addMember': 'resource-gated: модератор канала (moderators[])',
  'ChannelController.postMessage': 'resource-gated: участник канала',
  'ChannelController.editMessage': 'resource-gated: автор сообщения',
  'ChannelController.react': 'resource-gated: участник канала',
  'ChannelController.suggestMode': 'advisory: не создаёт данных (AR-18)',
  'ChannelController.ack': 'identity-gated: адресат подтверждает своё объявление',
  // Device flow / auth
  'DeviceController.authorize': 'oidc-spec: RFC 8628 device authorize (@Public)',
  'DeviceController.bind': 'identity-gated: пользователь привязывает своё устройство',
  'FlorController.backchannel': 'oidc-spec: back-channel logout (@Public, jose-верификация)',
  // Пилотный контур (временный, AR-15)
  'PilotController.createStaff': 'key-gated: x-pilot-owner-key (fail-closed)',
  'PilotController.revokeStaff': 'key-gated: x-pilot-owner-key (fail-closed)',
  'PilotController.createClass': 'key-gated: x-pilot-owner-key (fail-closed)',
  'PilotController.createSubject': 'key-gated: x-pilot-owner-key (fail-closed)',
  'PilotController.assign': 'key-gated: x-pilot-owner-key (fail-closed)',
  'PilotController.login': 'key-gated: одноразовый инвайт-токен',
  // Local storage (STORAGE_MODE=local): семантика presigned URL
  'LocalStorageController.put': 'key-gated: одноразовый PUT-токен (аналог presign)',
  // Schoolium 1.1.1, контур доступа (AR-94). Колонка «Право» в `70-screens.md` §11
  // у этих строк называет не код каталога, а владение: аноним со страницы входа,
  // сессия якорного устройства, владелец сессии, одноразовый токен.
  'SchoolAuthController.deviceLinkToken': 'аноним (§11 строка 1): страница /login заводит токен привязки до всякой сессии',
  'SchoolAuthController.deviceLinkApprove': 'identity-gated (§11 строка 2): подтверждает якорное устройство своей сессией, новая сессия наследует его школу и роли',
  'SchoolAuthController.verifyLoginCode': 'key-gated (§11 строка 36): одноразовый код с карточки, 5 минут (AR-92)',
  'SchoolAuthController.login': 'key-gated (AR-156): юзернейм+пароль, выданные модератором; LOGIN_FAILED не различает причин отказа',
  'SchoolAuthController.bootstrap': 'key-gated (AR-93): одноразовая ссылка платформенной операции, 24 часа',
  'SchoolAuthController.logout': 'identity-gated (§11 строка 3): человек завершает собственную сессию',
  'SchoolAuthController.endSession': 'identity-gated (§11 строка 38): владелец завершает свою сессию адресно, чужие в выборку не попадают',
  'SubjectsController.scan': 'identity-gated: педагог отмечает СВОЙ скан QR привязки своей сессией (S-70); строки в §11 нет намеренно — это не мутация школы',
  'StaffController.join': 'key-gated (§11 строка 5): одноразовый QR активации карточки; доверие даёт живая сессия модератора и присутствие (AR-76)',
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const container = app.get(ModulesContainer);

  const failures: string[] = [];
  const gated: string[] = [];
  const whitelisted: string[] = [];
  const usedCodes = new Set<string>();
  const seenWhitelistKeys = new Set<string>();

  for (const mod of container.values()) {
    for (const [, wrapper] of mod.controllers) {
      const ctor = wrapper.metatype as (new () => unknown) | undefined;
      if (!ctor) continue;
      const proto = ctor.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name] as object;
        if (typeof handler !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined || !MUTATIONS.has(method)) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const basePath = Reflect.getMetadata(PATH_METADATA, ctor) ?? '';
        const route = `${M[method]} /${String(basePath)}/${String(path)}`.replace(/\/+/g, '/');
        const key = `${ctor.name}.${name}`;
        const perm: string | undefined =
          Reflect.getMetadata(REQUIRE_PERMISSION, handler) ?? Reflect.getMetadata(REQUIRE_PERMISSION, ctor);
        const isPublic: boolean =
          (Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, ctor)) === true;

        if (perm) {
          usedCodes.add(perm);
          gated.push(`${route} → ${perm}`);
        } else if (WHITELIST[key]) {
          seenWhitelistKeys.add(key);
          whitelisted.push(`${route} — ${WHITELIST[key]}`);
        } else {
          failures.push(`${route} (${key})${isPublic ? ' [@Public]' : ''} — мутация без гейта и вне whitelist`);
        }
      }
    }
  }

  // коды из @RequirePermission обязаны существовать в каталоге и входить в ≥1 пакет
  const catalogCodes = new Set(PERMISSIONS.map((p) => p.code));
  const packagedCodes = new Set(ROLE_PACKAGES.flatMap((p) => p.permissions));
  for (const code of usedCodes) {
    if (!catalogCodes.has(code)) failures.push(`код "${code}" на роуте отсутствует в каталоге PERMISSIONS (опечатка?)`);
    else if (!packagedCodes.has(code)) failures.push(`код "${code}" не входит ни в один пакет роли — роут мёртв для всех`);
  }
  // протухшие строки whitelist (роут переименован/удалён) — тоже провал: whitelist не должен гнить
  for (const key of Object.keys(WHITELIST)) {
    if (!seenWhitelistKeys.has(key)) failures.push(`whitelist-строка "${key}" не сматчилась ни с одним роутом (протухла)`);
  }

  console.log(`Гейчено: ${gated.length} мутаций; whitelist: ${whitelisted.length}; каталог: ${catalogCodes.size} прав.`);
  for (const w of whitelisted) console.log(`  ~ ${w}`);
  if (failures.length) {
    console.log('\n✗ ДЫРЫ ПОКРЫТИЯ RBAC:');
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  await app.close();
  console.log(`\n${failures.length === 0 ? '✓ RBAC-ПОКРЫТИЕ ПОЛНОЕ' : '✗ ЕСТЬ ДЫРЫ'} — gated=${gated.length} whitelist=${whitelisted.length} fail=${failures.length}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
