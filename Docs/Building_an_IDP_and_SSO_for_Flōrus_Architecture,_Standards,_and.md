# Комплексное исследование: создание IDP (Identity Provider / SSO) для проектирования и доработки Flōrus

## TL;DR
- **Flōrus уже стоит на правильном фундаменте** (собственный OIDC-провайдер + versioned OpenAPI-контракт вместо связывания через код/БД), поэтому приоритет сейчас — не «переписать под гигантов», а закрыть безопасностный минимум: Authorization Code + PKCE везде (OAuth 2.1), refresh token rotation с reuse-detection, Argon2id для паролей, хэширование refresh-токенов в БД, `.well-known/openid-configuration` + JWKS, и жёсткое разграничение scopes для сервисов-клиентов (Schoolium и будущих мессенджера/почты).
- **Крупные игроки (Google, Яндекс ID, VK ID, Т-ID, Сбер ID) публично раскрывают протокольный слой** (endpoints, scopes, discovery) очень подробно, но **почти не раскрывают внутреннюю архитектуру хранения/шардирования** — это надо честно признать: паттерны «шардирование по user_id, read replicas, Redis для сессий, разделение auth-пути и profile-пути» описаны в общей инженерной литературе, а не в их документации.
- **Для одного сервера 2GB/2CPU** критично сейчас: разделить «горячий» auth-путь (проверка токена/сессии, локальная валидация JWT по JWKS) и «холодный» profile-путь на уровне схемы БД, шифровать PII at rest, ввести soft-delete + retention (архивация у вас уже есть), и НЕ внедрять пока ReBAC/Zanzibar, SAML, отдельный шардинг — это преждевременная оптимизация до появления реальной нагрузки.

## Key Findings

### 1. Что входит в полноценный IDP
Полноценный Identity Provider — это не «форма логина», а набор из ~10 компонентов: **authorization server** (выдаёт коды/токены), **token service** (issue/refresh/revoke, JWKS), **user store** (identity + credentials), **session management** (серверные сессии + SSO-cookie), **MFA/authenticator management**, **consent screen** (согласие пользователя на передачу данных сервису), **admin panel**, **audit log**, **provisioning** (SCIM), и **account lifecycle** (создание/архивация/удаление). У Flōrus это уже собрано в «IDP + account management hub».

**Разграничение понятий (границы ответственности):**
- **IDP** — узкая функция: аутентифицировать пользователя и выпустить токен/ассерцию, которой доверяют сервисы (Relying Parties). В модели OIDC IDP — это «специальный OAuth 2.0 authorization server» (OpenID Provider).
- **SSO** — это *свойство/сценарий* («один вход — доступ ко многим сервисам»), которое достигается поверх IDP, а не отдельный продукт.
- **IAM** — весь жизненный цикл идентичности и доступа (обычно для сотрудников/workforce): provisioning, роли, деинициализация.
- **CIAM** — тот же IAM, но для внешних пользователей/клиентов: самостоятельная регистрация, соцлогин, consent-механизмы, персонализация. **Flōrus по сути — это CIAM-платформа с ролью OpenID Provider для своей экосистемы.**

**Протоколы и их роли:**
- **OAuth 2.0 / 2.1** — авторизация (делегированный доступ, access tokens). OAuth 2.1 — консолидация лучших практик: Authorization Code + PKCE обязателен для всех типов клиентов, а implicit-flow и resource-owner-password grant формально удалены (см. чек-лист oauth.net: «Use the authorization code grant. Require PKCE with S256 for public clients... Do not offer the implicit grant. Do not offer the resource owner password credentials grant. Match registered redirect URIs exactly»).
- **OIDC** — тонкий identity-слой поверх OAuth 2.0: добавляет ID Token (JWT), userinfo endpoint, discovery. Это ядро Flōrus.
- **SAML 2.0** — XML-ориентированный SSO, доминирует в enterprise/legacy. Для экосистемы новых сервисов через единый OIDC API — **не нужен**, добавляет только сложность.
- **SCIM** — стандарт провижининга (создание/обновление/деактивация аккаунтов в сервисах-потребителях). SSO решает только «вход»; SCIM решает «жизненный цикл». Большинство инцидентов «уволенный сотрудник всё ещё может войти в SaaS» происходят не из-за SSO, а из-за отсутствия провижининга. [Chaos and Order](https://www.youngju.dev/blog/devops/2026-06-12-sso-fundamentals-saml-oauth2-oidc-comparison.en)
- **FIDO2/WebAuthn/passkeys** — фишинг-устойчивая беспарольная аутентификация на публичной криптографии; приватный ключ не покидает устройство, credential привязан к origin (домену), поэтому не воспроизводится на фишинговом сайте. [askmeidentity](https://askmeidentity.com/resources/standards/fido2-and-passkeys-explained/) FIDO2 = WebAuthn (браузерный API) + CTAP2 (протокол до аутентификатора). Passkey — discoverable FIDO-credential. [askmeidentity](https://askmeidentity.com/resources/standards/fido2-and-passkeys-explained/)

### 2. Мировые стандарты и спецификации
**RFC/спеки, которые реально соблюдать:**
- **RFC 6749** (OAuth 2.0 core) + **RFC 6750** (Bearer tokens).
- **RFC 7519 JWT**, **RFC 7515/7517 JWS/JWK** (подпись и ключи).
- **RFC 8414** — OAuth Authorization Server Metadata (discovery) и **OpenID Connect Discovery 1.0** (`/.well-known/openid-configuration`).
- **RFC 7636 PKCE** — обязателен в OAuth 2.1.
- **RFC 7009** — token revocation endpoint; **RFC 7662** — token introspection.
- **RFC 9700 (BCP 240), опубликован в январе 2025** авторами T. Lodderstedt (SPRIND), J. Bradley (Yubico), A. Labunets и D. Fett (Authlete) — **Best Current Practice for OAuth 2.0 Security**. Официально «updates and extends the threat model and security advice given in RFCs 6749, 6750, and 6819»; [RFC Editor](https://www.rfc-editor.org/info/rfc9700/) [ietf](https://datatracker.ietf.org/doc/rfc9700/) формально deprecates implicit-flow и password grant, требует PKCE для всех authorization-code-потоков. [OAuth](https://oauth.net/2/oauth-best-practice/) Практика: точное совпадение redirect_uri, sender-constrained токены (mTLS **RFC 8705** или DPoP **RFC 9449**), refresh token rotation для публичных клиентов. [IETF](https://datatracker.ietf.org/doc/rfc9700/)
- **RFC 9106** — Argon2 (для парольного хэширования).

**NIST SP 800-63-4 (Date Published: July 2025, авторы D. Temoshok et al.), superseding SP 800-63-3 (03/02/2020):** финализирована по итогам ~4-летнего процесса с почти 6 000 публичных комментариев; [nist](https://pages.nist.gov/800-63-4) ревизия -3 официально superseded с 1 августа 2025. [nist](https://pages.nist.gov/800-63-3/sp800-63a.html) Три независимых «оси» доверия:
- **IAL** (Identity Assurance Level) — насколько надёжно проверена личность при регистрации (IAL1 — без проверки). [ID Dataweb](https://www.iddataweb.com/2025-nist-guidelines/)
- **AAL** (Authenticator Assurance Level) — сила аутентификации (AAL1 — один фактор; AAL2 — MFA; AAL3 — фишинг-устойчивый аппаратный фактор). [ScrambleID](https://www.scrambleid.com/learn/what-are-nist-aal-levels) В -4 любая реализация AAL2 обязана предлагать пользователю фишинг-устойчивую MFA-опцию (например, FIDO2-ключи). [ID Dataweb](https://www.iddataweb.com/2025-nist-guidelines/)
- **FAL** (Federation Assurance Level) — сила федеративной ассерции.
Оси декуплированы — выбираются отдельно по риск-оценке. [Cybersigmacs](https://cybersigmacs.com/knowledge-center/nist-800-63/) Для Flōrus реалистичный таргет: **IAL1 + AAL2 (MFA) + passkeys как AAL2/AAL3-опция**.

**GDPR / 152-ФЗ для self-hosted IDP в России:**
- С 1 июля 2025 действует обновлённая ч.5 ст.18 152-ФЗ: **первичный сбор, запись, систематизация, накопление и хранение ПДн граждан РФ — только в базах данных на территории РФ**. [CISOCLUB](https://cisoclub.ru/izmenenija-v-zakone-152-fz-o-personalnyh-dannyh-i-objazatelnye-mery-bezopasnosti/) Для Flōrus (сервер в РФ) это выполняется, но важно, чтобы бэкапы и любые внешние сервисы тоже были в РФ. Нарушение локализации влечёт крупные административные штрафы. [CISOCLUB](https://cisoclub.ru/izmenenija-v-zakone-152-fz-o-personalnyh-dannyh-i-objazatelnye-mery-bezopasnosti/)
- Нужны: политика обработки ПДн в открытом доступе, назначенный ответственный, ограничение сроков хранения целями обработки (retention policy), отдельное согласие на обработку.
- GDPR-паттерны (право на забвение, Art. 17) полезны как архитектурный ориентир даже если GDPR формально не применяется: «удаление из операционных систем + минимальный набор в ограниченном архиве по юридическому основанию». [DOCBYTE](https://www.docbyte.com/gdpr-delete-retain-archive/)

**Best practices по токенам:**
- Access token короткоживущий: 5–15 мин для чувствительных API, 30–60 мин для general-purpose. [Obsidian Security](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)
- Refresh token: rotation на каждом использовании, invalidate предыдущего, [WorkOS](https://workos.com/blog/why-your-app-needs-refresh-tokens-and-how-they-work) **reuse-detection → отзыв всего token family**. Срок 7–30 дней для чувствительных, до нескольких недель для обычных. [Obsidian Security](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)
- Revocation endpoint (RFC 7009) вызывать при logout и смене пароля.
- Минимальные scopes, `aud` (audience) на конкретный resource server. [DEV Community](https://dev.to/kimmaida/oauth-20-security-best-practices-for-developers-2ba5)

### 3. Устройство у крупных игроков

**Общий вывод: все пятеро подробно документируют протокольный/партнёрский слой, но не внутреннюю архитектуру хранения.**

**Google** — эталон OIDC: discovery `https://accounts.google.com/.well-known/openid-configuration`, OpenID-сертифицирован, [Google](https://developers.google.com/identity/openid-connect/openid-connect) JWKS с кэшированием (локальная валидация JWT эффективнее, чем tokeninfo endpoint), [Google](https://developers.google.com/identity/openid-connect/openid-connect) consent screen с принципом least privilege и верификацией приложений. [OneUptime](https://oneuptime.com/blog/post/2026-02-17-how-to-configure-oauth-consent-screen-and-api-scopes-for-least-privilege-in-gcp/view)

**Яндекс ID** — OAuth 2.0 с JWT-опцией (не позиционируется как полный OIDC). Endpoints: authorize `https://oauth.yandex.ru/authorize`, token `https://oauth.yandex.ru/token`, userinfo `GET https://login.yandex.ru/info`. Права — «группы разрешений» (официально: «Authorization apps can be granted no more than three permission groups... the login:info scope belongs to the login group»), [Yandex](https://yandex.com/dev/id/doc/en/register-client) scopes вида `login:info`, `login:email`, `login:avatar`. Профиль возвращает `id`, `login`, `client_id`, `psuid`, а по правам — `emails`/`default_email`, аватар (`default_avatar_id`), `birthday`, имя/пол (`first_name`/`last_name`/`sex`), `default_phone`.

**VK ID** — OAuth 2.1 с обязательным PKCE (S256); client_secret заменён на PKCE при обмене кода. [Bedolaga Docs](https://docs.bedolagam.ru/cabinet/oauth-setup) Authorize `https://id.vk.ru/authorize` (с `code_challenge_method=S256`), [GitHub](https://github.com/movemoveapp/vkid) userinfo `POST https://id.vk.ru/oauth2/user_info`. [Bedolaga Docs](https://docs.bedolagam.ru/cabinet/oauth-setup) Scopes: базовые (имя, фамилия, фото, пол, дата рождения, почта) и расширенные (телефон — требует подтверждения бизнес-профиля). [vk](https://vk.ru/dev/authcode_flow_user) Официальное уведомление VK: «После 30 сентября все API-интеграции и авторизации будут доступны только через домен vk.ru» [Drupal](https://www.drupal.org/project/social_auth_vk/issues/3548585) — то есть легаси `oauth.vk.com`/`id.vk.com` (OAuth 2.0) перестали работать 30 сентября 2025 [Bedolaga Docs](https://docs.bedolagam.ru/cabinet/oauth-setup) в рамках миграции доменов vk.com → vk.ru (домен vk.ru приобретён VK в 2022 г.). [Habr](https://habr.com/ru/news/943232/)

**Т-Банк ID (T-ID / Tinkoff ID)** — OAuth 2.0 + OpenID Connect (verbatim: «единая точка авторизации для всего Т‑Банка... Работает по протоколам OAuth 2.0 и OpenID Connect»). [github](https://tinkoff.github.io/tinkoff-id/) [Tinkoff](https://tinkoff.github.io/tinkoff-id/) Endpoints: authorize `https://id.tinkoff.ru/auth/authorize`, [github](https://tinkoff.github.io/tinkoff-id/w2w/) token `https://id.tinkoff.ru/auth/token`, [github](https://tinkoff.github.io/tinkoff-id/w2w/) introspect `https://id.tinkoff.ru/auth/introspect`, [github](https://tinkoff.github.io/tinkoff-id/w2w/) userinfo `POST https://id.tinkoff.ru/userinfo/userinfo`. [Tinkoff](https://tinkoff.github.io/tinkoff-id/userinfo/) Базовый userinfo по scopes `profile`/`phone`/`email` (`sub`, `name`, `gender`, `birthdate`, `family_name`/`given_name`/`middle_name`, `phone_number`, `email` + `_verified`). [github](https://tinkoff.github.io/tinkoff-id/userinfo/) Расширенные данные (паспорт, ИНН, СНИЛС, водительские, самозанятость) — через отдельные методы API, каждый требует согласия и отдельного scope. [4PDA](https://www.tadviser.ru/index.php/%D0%9F%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82:T-ID_%28%D1%80%D0%B0%D0%BD%D0%B5%D0%B5_Tinkoff_ID,_%D0%A2%D0%B8%D0%BD%D1%8C%D0%BA%D0%BE%D1%84%D1%84_ID%29) Два продукта: Tinkoff ID (физлица) и Tinkoff Business ID (ИП/юрлица). [Tbank](https://developer.tbank.ru/docs/intro/partner/tid) [T-Bank](https://www.tbank.ru/business/help/solutions/tinkoff-id/partnership/why-tinkoff-id/) Подключение — заявка → договор → client_id/client_secret на почту. [Tinkoff](https://tinkoff.github.io/tinkoff-id/faq/)

**Сбер ID** — OIDC. `openid` обязателен и на первой позиции («Значение openid является обязательным и располагается на первой позиции»). [Sberbank](https://developers.sber.ru/docs/ru/sberid/sdk/javascript/current/connection) [GitHub](https://github.com/SberID/js-sdk) Scopes сгруппированы в пакеты: **Light** (`openid`→sub, `email`, `mobile`→phone_number), **Standart** (`birthdate`, `name`→family/given/middle, `gender`), **Professional** (`maindoc`→паспорт, `inn`, `snils`, `driving_license`, адреса и т.д.). [Sber](https://api.developer.sber.ru/product/SberbankID/doc/v1/reqparametrs) Сценарии: Web to Web, Web to Web SSO, mWeb to App, App to App (+SSO), OIDC to App. [Sberbank](https://developers.sber.ru/docs/ru/sberid/service/overview) Партнёрство: регистрация на портале → оферта по ЭДО → Client ID + Client Secret + сертификат [Sberbank](https://developers.sber.ru/docs/ru/sberid/guidebook/overview) безопасности [Sberbank](https://developers.sber.ru/docs/ru/sberid/service/overview) (mTLS). Вход по iFrame запрещён. [Sberbank](https://developers.sber.ru/docs/ru/sberid/service/overview)

**Архитектурные паттерны хранения профиля (обобщённо, из инженерной литературы — не из докдок игроков):** типовое разделение слоёв — **core identity** (стабильный immutable user_id/sub), **auth credentials** (пароль-хэш, MFA-секреты, passkeys), **profile** (изменяемые ПДн), **sessions** (эфемерные, в Redis/in-memory с TTL), **devices** (парк устройств, fingerprints). «Быстрый» auth-путь (проверка токена/сессии) отделяется от «медленного» profile-пути: auth читает из кэша/сессионного стора и валидирует JWT локально по JWKS без обращения к БД профиля; обновление профиля идёт по отдельному, более «тяжёлому» пути.

**Шардирование/масштабирование (общие паттерны, не докдок игроков):** путь масштабирования БД — сначала оптимизация запросов → кэш → read replicas [kindatechnical\(\)](https://kindatechnical.com/microservices-architecture/database-scaling-sharding-read-replicas-connection-pooling.html) (90%+ трафика auth — чтение) [kindatechnical\(\)](https://kindatechnical.com/microservices-architecture/database-scaling-sharding-read-replicas-connection-pooling.html) → connection pooling → и только в крайнем случае шардирование по user_id. Сессии — в Redis (sub-миллисекундный доступ, TTL, decouple от server affinity). [DEV Community](https://dev.to/shieldstring/session-management-rate-limiting-caching-using-redis-4poi) Redis Cluster шардирует по 16384 hash-слотам. [Redis](https://redis.io/tutorials/operate/redis-at-scale/scalability/)

### 4. Стандарты хранения
- **Пароли:** Argon2id (OWASP-дефолт, RFC 9106). OWASP Password Storage Cheat Sheet (ревизия 2025), verbatim: «Use Argon2id with a minimum configuration of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism»; [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) альтернатива «m=47104 (46 MiB), t=1, p=1 (Do not use with Argon2i)». [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) Базовый набор t=2/m=19 MiB даёт «around 100ms of verification time on a modern x86 server core». [Gupta Deepak](https://guptadeepak.com/bcrypt-vs-argon2-vs-scrypt-vs-pbkdf2-password-hashing-decision-framework-2026/) bcrypt cost≥12 допустим для легаси. [Toolsana](https://toolsana.com/blog/password-hashing-2026-bcrypt-argon2-scrypt-pbkdf2-guide/) **Важно для Flōrus с 2GB RAM:** высокая memory_cost Argon2id при пиках логина конкурирует за RAM — нужно тюнить осторожно (например m≈19–46 MiB) и/или ограничивать параллелизм.
- **Refresh-токены:** хранить **хэш** (например SHA-256) — как Apigee, который хэширует все access/refresh токены и валидирует входящий против хэша в БД. [google](https://docs.cloud.google.com/apigee/docs/api-platform/security/oauth/hashing-tokens) Дополнительно можно шифровать at rest. При компрометации БД сырые токены не утекают.
- **Секреты клиентов (client_secret):** хэшировать/шифровать, не хранить в открытом виде.
- **Persistent-сессии и device fingerprints:** серверный сессионный стор (Redis) с метаданными (IP, user-agent, device fingerprint) [WorkOS](https://workos.com/blog/why-your-app-needs-refresh-tokens-and-how-they-work) для reuse-detection и «список активных сессий/устройств».
- **Разделение PII и auth-данных:** отдельные таблицы/схемы, шифрование PII at rest (можно column-level или tokenization для самых чувствительных полей); ключи — вне БД.
- **Soft-delete / архивация / retention:** GDPR (EDPB 05/2019) требует, чтобы удаление было «verifiable and irreversible» — чистый soft-delete не является доказанным удалением. [arxiv](https://arxiv.org/pdf/2606.18497) Паттерн: (1) архивация/ограничение обработки в операционной системе; (2) минимальный набор в ограниченном архиве по юридическому основанию; [DOCBYTE](https://www.docbyte.com/gdpr-delete-retain-archive/) (3) авто-удаление по истечении retention; (4) crypto-shredding (уничтожение ключа шифрования) как способ «необратимого» удаления при неизменяемых бэкапах. [arxiv](https://arxiv.org/pdf/2606.18497) **У Flōrus архивация аккаунтов уже есть — надо добавить к ней явный retention-таймер и путь к необратимому удалению.**

### 5. Границы модерации и прав
**Модели доступа:**
- **RBAC** — роли (admin/member/...). Прост, легко аудировать; риск «role explosion». [Aserto](https://www.aserto.com/blog/rbac-vs-rebac)
- **ABAC** — правила по атрибутам (время, регион, статус). Гибкий контекст, [Oso](https://www.osohq.com/learn/rbac-vs-abac-vs-rebac-what-is-the-best-access-policy-paradigm) тяжелее аудировать.
- **ReBAC** — граф отношений (модель Google Zanzibar; SpiceDB, OpenFGA). Для «пошарить объект конкретному пользователю», вложенных групп, иерархий. [Gupta Deepak](https://guptadeepak.com/guides/rbac-abac-rebac-pbac/) Операционно тяжёл (нужен консистентный low-latency граф, «zookie»-токены).
- **Вывод для Flōrus:** начать с **RBAC** для admin/сервисных ролей + **OAuth scopes** для доступа сервисов-потребителей; ABAC/ReBAC не нужны, пока нет per-object sharing.

**Три уровня прав (границы):**
1. **Admin/root IDP** — полный доступ к платформе (управление клиентами, ключами, аккаунтами). Для админ-консолей — обязательный фишинг-устойчивый MFA (FIDO2). [East Bay Cyber](https://eastbaycyber.com/content/glossary-fido2-what-it-is-and-why-it-matters/)
2. **Права сервисов-клиентов (scopes)** — что может запросить Schoolium / мессенджер / почта. Дизайн scopes: разделять по бизнес-области и чувствительности, [Curity](https://curity.io/resources/learn/scope-best-practices/) hierarchical (`profile:read` / `profile:write`), read-only по умолчанию, write-суффикс только при необходимости, [Obsidian Security](https://www.obsidiansecurity.com/blog/oauth-scopes-permissions-security-best-practices) least privilege, first-party клиентам можно отключать consent-экран. [Curity](https://curity.io/resources/learn/scope-best-practices/) Например Schoolium: `openid profile:read email` — и НЕ давать `write` или доступ к устройствам, если не нужно.
3. **Права пользователя над своим аккаунтом** — просмотр/отзыв согласий, список активных сессий и устройств, самостоятельный logout, управление MFA.

**Модерационные инструменты (как обычно реализовано):**
- **Блокировка аккаунта** — флаг статуса, при котором auth-путь отказывает.
- **Принудительный logout всех сессий** — удаление всех записей в сессионном сторе + отзыв всех refresh token family пользователя.
- **Ограничение по подозрению в компрометации** — reuse-detection refresh-токена → отзыв всего family; сравнение IP/device fingerprint с контекстом выпуска; step-up аутентификация (доп. фактор при подозрительном входе).

## Details
Практический синтез: Flōrus — это CIAM/OpenID Provider для собственной экосистемы, и его сильная сторона — уже принятое решение синхронизировать сервисы через versioned OpenAPI-контракт, а не через общий код/БД. Это ровно та граница, которую в больших системах проводят намеренно: сервисы-потребители (Schoolium, будущий мессенджер, почта) не должны знать внутреннюю схему IDP — они видят только стабильный OIDC/OpenAPI-интерфейс (ID Token + userinfo + scopes). Это позволяет менять внутреннее хранение (в т.ч. вводить шардинг/реплики позже) без ломки клиентов.

Ключевая архитектурная идея, которую стоит зафиксировать в схеме уже сейчас, при 2GB/2CPU: **fast path vs slow path**. Быстрый путь (проверка сессии/токена, локальная валидация подписи JWT по опубликованному JWKS) не должен трогать «тяжёлую» БД профиля — иначе каждый запрос любого сервиса будет упираться в неё. Медленный путь (чтение/обновление ПДн профиля, управление устройствами) идёт отдельно. Даже если физически это одна PostgreSQL-инстанция, логическое разделение схем (core identity / credentials / profile / sessions / devices) стоит почти ничего и окупается при первом же росте нагрузки, когда часть таблиц уедет на реплики или в отдельный стор.

## Recommendations (что делать в Flōrus — стадийно)

**Сделать СЕЙЧАС (безопасностный и архитектурный минимум, влезает в 2GB/2CPU):**
1. **Протокол:** Authorization Code + PKCE (S256) для всех клиентов; удалить implicit/password grant, если есть. Точное совпадение redirect_uri. Опубликовать `/.well-known/openid-configuration` + JWKS; клиенты валидируют ID/JWT-токены локально по JWKS.
2. **Токены:** access 10–15 мин; refresh 14–30 дней с rotation + reuse-detection (отзыв всего family); revocation endpoint (RFC 7009) на logout и смене пароля; `aud` на конкретный сервис.
3. **Хранение:** Argon2id (m≈19–46 MiB, t=2–3, p=1 — осторожно с RAM, целясь в ~100 мс верификации на вашем 2CPU); refresh-токены и client_secret хранить хэшированными; PII шифровать at rest, ключи вне БД.
4. **Разделение путей в схеме БД:** уже сейчас логически разнести core identity / credentials / profile / sessions / devices — это дёшево и окупится при росте. Сессии — в лёгком in-memory/Redis-совместимом сторе с TTL (можно один инстанс).
5. **Права:** RBAC (admin/service/user) + строго ограниченные OAuth scopes на каждый сервис (Schoolium — минимум). Consent-экран для не-first-party (в будущем).
6. **Модерация:** блокировка аккаунта, «выйти со всех устройств» (сброс сессий + отзыв refresh family), список активных сессий/устройств для пользователя.
7. **Комплаенс 152-ФЗ:** убедиться, что сервер, бэкапы и любые зависимости — в РФ; политика обработки ПДн; retention-таймер к вашей архивации; путь к необратимому удалению (crypto-shredding).
8. **MFA:** минимум TOTP; заложить WebAuthn/passkeys (фишинг-устойчивость) хотя бы для админов.
9. **Audit log** всех security-событий (логины, отказы, отзывы, reuse-detection).

**Отложить до реального роста нагрузки/числа сервисов:**
- Шардирование по user_id, read replicas, отдельный кластер Redis — вводить по метрикам (см. пороги ниже), а не заранее.
- SAML 2.0 — только если появится enterprise-потребитель, требующий его.
- SCIM — когда сервисам понадобится автоматический провижининг/деинициализация аккаунтов (не только логин).
- ReBAC/Zanzibar (OpenFGA/SpiceDB) — только при появлении per-object sharing.
- Sender-constrained токены (mTLS/DPoP) — при работе с особо чувствительными данными или high-value угрозах.
- FAPI-профили — если появятся финансовые/особо регулируемые сценарии.

**Пороги, которые меняют решения (benchmarks):**
- CPU auth-пути стабильно >60–70% или задержка логина из-за Argon2id >250 мс → вынести сессии/кэш на отдельный инстанс, снизить memory_cost или добавить ядро.
- Один primary по записи не справляется / рост до сотен тысяч активных пользователей → read replicas, затем шардирование по user_id.
- Появился 3-й+ внешний (не first-party) сервис-потребитель → полноценный consent-экран, ужесточение scope-review, возможно SCIM.
- Инциденты с уводом токенов → sender-constrained токены (DPoP), обязательный passkey для чувствительных ролей.

## Caveats
- **Внутренняя архитектура хранения/шардирования Google, Яндекс ID, VK ID, Т-ID, Сбер ID публично НЕ документирована** в их developer-доках. Конкретные паттерны («шардирование по user_id», «read replicas», «Redis для сессий», «разделение fast/slow path») в отчёте взяты из общей инженерной литературы (Redis, system-design источники) и применимы как индустриальный стандарт, но не являются подтверждённым описанием именно их продакшена. Где данных нет — это отмечено явно.
- **VK ID:** детали OAuth 2.1/PKCE(S256), endpoint `id.vk.ru/authorize` и `/oauth2/user_info` подтверждены множеством согласующихся SDK и вторичных источников; часть глубоких бизнес-докдок VK на момент исследования были недоступны (техработы). Формулировка «legacy OAuth 2.0 прекратил работу 30.09.2025» точнее описывается как дедлайн миграции доменов vk.com → vk.ru.
- **Т-Банк ID** в процессе ребрендинга: официальные доки используют и `id.tinkoff.ru`, и `id.tbank.ru` — трактуйте как переходные/эквивалентные.
- **NIST SP 800-63-4** финализирована в июле 2025 и заменяет -63-3 (superseded с 1 августа 2025); при аудите сверяйтесь с актуальной ревизией.
- **Параметры Argon2id и сроки токенов** — ориентиры OWASP/RFC 9700 на 2025–2026; их надо тюнить под реальное железо Flōrus (замер времени верификации на вашем 2CPU 3.3GHz).
- Рекомендации даны под текущий масштаб Flōrus (один недорогой сервер); при существенном росте архитектурные решения нужно пересматривать по указанным порогам.