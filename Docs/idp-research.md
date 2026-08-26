# Устройство идеального IDP (Identity Provider): архитектура, мировые стандарты, устройство у крупных игроков

## TL;DR
- Полноценный IDP — это не «форма логина», а система из ~10 компонентов (authorization server, token service, user store, session management, MFA, consent screen, admin panel, audit log, provisioning, account lifecycle), построенная поверх стандартных протоколов: OAuth 2.0/2.1, OIDC, SAML 2.0, SCIM, FIDO2/WebAuthn.
- **Крупные игроки (Google, Яндекс ID, VK ID, Т-ID, Сбер ID) публично раскрывают протокольный слой** (endpoints, scopes, discovery) очень подробно, но **почти не раскрывают внутреннюю архитектуру хранения/шардирования** — паттерны «шардирование по user_id, read replicas, Redis для сессий, разделение auth-пути и profile-пути» описаны в общей инженерной литературе, а не в их документации.
- Индустриальный консенсус на 2025–2026: Authorization Code + PKCE как единственный поток (OAuth 2.1 / RFC 9700), refresh token rotation с reuse-detection, Argon2id для паролей, хэширование токенов в БД, строгое разграничение OAuth scopes между admin/сервисами/пользователем.

## Key Findings

### 1. Что входит в полноценный IDP
Полноценный Identity Provider — это набор из ~10 компонентов: **authorization server** (выдаёт коды/токены), **token service** (issue/refresh/revoke, JWKS), **user store** (identity + credentials), **session management** (серверные сессии + SSO-cookie), **MFA/authenticator management**, **consent screen** (согласие пользователя на передачу данных сервису), **admin panel**, **audit log**, **provisioning** (SCIM), и **account lifecycle** (создание/архивация/удаление).

**Разграничение понятий (границы ответственности):**
- **IDP** — узкая функция: аутентифицировать пользователя и выпустить токен/ассерцию, которой доверяют сервисы (Relying Parties). В модели OIDC IDP — это «специальный OAuth 2.0 authorization server» (OpenID Provider).
- **SSO** — это *свойство/сценарий* («один вход — доступ ко многим сервисам»), которое достигается поверх IDP, а не отдельный продукт.
- **IAM** — весь жизненный цикл идентичности и доступа (обычно для сотрудников/workforce): provisioning, роли, деинициализация.
- **CIAM** — тот же IAM, но для внешних пользователей/клиентов: самостоятельная регистрация, соцлогин, consent-механизмы, персонализация.

**Протоколы и их роли:**
- **OAuth 2.0 / 2.1** — авторизация (делегированный доступ, access tokens). OAuth 2.1 — консолидация лучших практик: Authorization Code + PKCE обязателен для всех типов клиентов, а implicit-flow и resource-owner-password grant формально удалены (чек-лист oauth.net: «Use the authorization code grant. Require PKCE with S256 for public clients... Do not offer the implicit grant. Do not offer the resource owner password credentials grant. Match registered redirect URIs exactly»).
- **OIDC** — тонкий identity-слой поверх OAuth 2.0: добавляет ID Token (JWT), userinfo endpoint, discovery.
- **SAML 2.0** — XML-ориентированный SSO, доминирует в enterprise/legacy-сценариях.
- **SCIM** — стандарт провижининга (создание/обновление/деактивация аккаунтов в сервисах-потребителях). SSO решает только «вход»; SCIM решает «жизненный цикл». Большинство инцидентов «уволенный сотрудник всё ещё может войти в SaaS» происходят не из-за SSO, а из-за отсутствия провижининга.
- **FIDO2/WebAuthn/passkeys** — фишинг-устойчивая беспарольная аутентификация на публичной криптографии; приватный ключ не покидает устройство, credential привязан к origin (домену), поэтому не воспроизводится на фишинговом сайте. FIDO2 = WebAuthn (браузерный API) + CTAP2 (протокол до аутентификатора). Passkey — discoverable FIDO-credential.

### 2. Мировые стандарты и спецификации
**RFC/спеки, которые считаются обязательным минимумом:**
- **RFC 6749** (OAuth 2.0 core) + **RFC 6750** (Bearer tokens).
- **RFC 7519 JWT**, **RFC 7515/7517 JWS/JWK** (подпись и ключи).
- **RFC 8414** — OAuth Authorization Server Metadata (discovery) и **OpenID Connect Discovery 1.0** (`/.well-known/openid-configuration`).
- **RFC 7636 PKCE** — обязателен в OAuth 2.1.
- **RFC 7009** — token revocation endpoint; **RFC 7662** — token introspection.
- **RFC 9700 (BCP 240), опубликован в январе 2025** авторами T. Lodderstedt (SPRIND), J. Bradley (Yubico), A. Labunets и D. Fett (Authlete) — **Best Current Practice for OAuth 2.0 Security**. Официально «updates and extends the threat model and security advice given in RFCs 6749, 6750, and 6819»; формально deprecates implicit-flow и password grant, требует PKCE для всех authorization-code-потоков. Практика: точное совпадение redirect_uri, sender-constrained токены (mTLS **RFC 8705** или DPoP **RFC 9449**), refresh token rotation для публичных клиентов.
- **RFC 9106** — Argon2 (для парольного хэширования).

**NIST SP 800-63-4 (Date Published: July 2025, авторы D. Temoshok et al.), superseding SP 800-63-3 (03/02/2020):** финализирована по итогам ~4-летнего процесса с почти 6 000 публичных комментариев; ревизия -3 официально superseded с 1 августа 2025. Три независимых «оси» доверия:
- **IAL** (Identity Assurance Level) — насколько надёжно проверена личность при регистрации (IAL1 — без проверки).
- **AAL** (Authenticator Assurance Level) — сила аутентификации (AAL1 — один фактор; AAL2 — MFA; AAL3 — фишинг-устойчивый аппаратный фактор). В -4 любая реализация AAL2 обязана предлагать пользователю фишинг-устойчивую MFA-опцию (например, FIDO2-ключи).
- **FAL** (Federation Assurance Level) — сила федеративной ассерции.
Оси декуплированы — выбираются отдельно по риск-оценке.

**GDPR / 152-ФЗ для хранения ПДн в РФ:**
- С 1 июля 2025 действует обновлённая ч.5 ст.18 152-ФЗ: **первичный сбор, запись, систематизация, накопление и хранение ПДн граждан РФ — только в базах данных на территории РФ**. Нарушение локализации влечёт крупные административные штрафы.
- Требуется: политика обработки ПДн в открытом доступе, назначенный ответственный, ограничение сроков хранения целями обработки (retention policy), отдельное согласие на обработку.
- GDPR-паттерны (право на забвение, Art. 17) — полезный архитектурный ориентир даже вне юрисдикции ЕС: «удаление из операционных систем + минимальный набор в ограниченном архиве по юридическому основанию».

**Best practices по токенам:**
- Access token короткоживущий: 5–15 мин для чувствительных API, 30–60 мин для general-purpose.
- Refresh token: rotation на каждом использовании, invalidate предыдущего, **reuse-detection → отзыв всего token family**. Срок 7–30 дней для чувствительных, до нескольких недель для обычных.
- Revocation endpoint (RFC 7009) вызывать при logout и смене пароля.
- Минимальные scopes, `aud` (audience) на конкретный resource server.

### 3. Устройство у крупных игроков
**Общий вывод: все пятеро подробно документируют протокольный/партнёрский слой, но не внутреннюю архитектуру хранения.**

**Google** — эталон OIDC: discovery `https://accounts.google.com/.well-known/openid-configuration`, OpenID-сертифицирован, JWKS с кэшированием (локальная валидация JWT эффективнее, чем tokeninfo endpoint), consent screen с принципом least privilege и верификацией приложений.

**Яндекс ID** — OAuth 2.0 с JWT-опцией (не позиционируется как полный OIDC). Endpoints: authorize `https://oauth.yandex.ru/authorize`, token `https://oauth.yandex.ru/token`, userinfo `GET https://login.yandex.ru/info`. Права — «группы разрешений» (официально: «Authorization apps can be granted no more than three permission groups... the login:info scope belongs to the login group»), scopes вида `login:info`, `login:email`, `login:avatar`. Профиль возвращает `id`, `login`, `client_id`, `psuid`, а по правам — `emails`/`default_email`, аватар (`default_avatar_id`), `birthday`, имя/пол (`first_name`/`last_name`/`sex`), `default_phone`.

**VK ID** — OAuth 2.1 с обязательным PKCE (S256); client_secret заменён на PKCE при обмене кода. Authorize `https://id.vk.ru/authorize` (с `code_challenge_method=S256`), userinfo `POST https://id.vk.ru/oauth2/user_info`. Scopes: базовые (имя, фамилия, фото, пол, дата рождения, почта) и расширенные (телефон — требует подтверждения бизнес-профиля). Официальное уведомление VK: «После 30 сентября все API-интеграции и авторизации будут доступны только через домен vk.ru» — то есть легаси `oauth.vk.com`/`id.vk.com` (OAuth 2.0) перестали работать 30 сентября 2025 в рамках миграции доменов vk.com → vk.ru (домен vk.ru приобретён VK в 2022 г.).

**Т-Банк ID (T-ID / Tinkoff ID)** — OAuth 2.0 + OpenID Connect (verbatim: «единая точка авторизации для всего Т‑Банка... Работает по протоколам OAuth 2.0 и OpenID Connect»). Endpoints: authorize `https://id.tinkoff.ru/auth/authorize`, token `https://id.tinkoff.ru/auth/token`, introspect `https://id.tinkoff.ru/auth/introspect`, userinfo `POST https://id.tinkoff.ru/userinfo/userinfo`. Базовый userinfo по scopes `profile`/`phone`/`email` (`sub`, `name`, `gender`, `birthdate`, `family_name`/`given_name`/`middle_name`, `phone_number`, `email` + `_verified`). Расширенные данные (паспорт, ИНН, СНИЛС, водительские, самозанятость) — через отдельные методы API, каждый требует согласия и отдельного scope. Два продукта: Tinkoff ID (физлица) и Tinkoff Business ID (ИП/юрлица). Подключение — заявка → договор → client_id/client_secret на почту.

**Сбер ID** — OIDC. `openid` обязателен и на первой позиции («Значение openid является обязательным и располагается на первой позиции»). Scopes сгруппированы в пакеты: **Light** (`openid`→sub, `email`, `mobile`→phone_number), **Standart** (`birthdate`, `name`→family/given/middle, `gender`), **Professional** (`maindoc`→паспорт, `inn`, `snils`, `driving_license`, адреса и т.д.). Сценарии: Web to Web, Web to Web SSO, mWeb to App, App to App (+SSO), OIDC to App. Партнёрство: регистрация на портале → оферта по ЭДО → Client ID + Client Secret + сертификат безопасности (mTLS). Вход по iFrame запрещён.

**Архитектурные паттерны хранения профиля (обобщённо, из инженерной литературы — не из докдок игроков):** типовое разделение слоёв — **core identity** (стабильный immutable user_id/sub), **auth credentials** (пароль-хэш, MFA-секреты, passkeys), **profile** (изменяемые ПДн), **sessions** (эфемерные, в Redis/in-memory с TTL), **devices** (парк устройств, fingerprints). «Быстрый» auth-путь (проверка токена/сессии) отделяется от «медленного» profile-пути: auth читает из кэша/сессионного стора и валидирует JWT локально по JWKS без обращения к БД профиля; обновление профиля идёт по отдельному, более «тяжёлому» пути.

**Шардирование/масштабирование (общие паттерны, не докдок игроков):** типовой путь масштабирования БД — сначала оптимизация запросов → кэш → read replicas (90%+ трафика auth — чтение) → connection pooling → и только в крайнем случае шардирование по user_id. Сессии — в Redis (sub-миллисекундный доступ, TTL, decouple от server affinity). Redis Cluster шардирует по 16384 hash-слотам.

### 4. Стандарты хранения
- **Пароли:** Argon2id (OWASP-дефолт, RFC 9106). OWASP Password Storage Cheat Sheet (ревизия 2025), verbatim: «Use Argon2id with a minimum configuration of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism»; альтернатива «m=47104 (46 MiB), t=1, p=1 (Do not use with Argon2i)». Базовый набор t=2/m=19 MiB даёт «around 100ms of verification time on a modern x86 server core». bcrypt cost≥12 допустим для легаси-систем.
- **Refresh-токены:** хранить **хэш** (например SHA-256) — как Apigee, который хэширует все access/refresh токены и валидирует входящий против хэша в БД. Дополнительно можно шифровать at rest. При компрометации БД сырые токены не утекают.
- **Секреты клиентов (client_secret):** хэшировать/шифровать, не хранить в открытом виде.
- **Persistent-сессии и device fingerprints:** серверный сессионный стор (Redis) с метаданными (IP, user-agent, device fingerprint) для reuse-detection и «список активных сессий/устройств».
- **Разделение PII и auth-данных:** отдельные таблицы/схемы, шифрование PII at rest (можно column-level или tokenization для самых чувствительных полей); ключи — вне БД.
- **Soft-delete / архивация / retention:** GDPR (EDPB 05/2019) требует, чтобы удаление было «verifiable and irreversible» — чистый soft-delete не является доказанным удалением. Паттерн: (1) архивация/ограничение обработки в операционной системе; (2) минимальный набор в ограниченном архиве по юридическому основанию; (3) авто-удаление по истечении retention; (4) crypto-shredding (уничтожение ключа шифрования) как способ «необратимого» удаления при неизменяемых бэкапах.

### 5. Границы модерации и прав
**Модели доступа:**
- **RBAC** — роли (admin/member/...). Прост, легко аудировать; риск «role explosion».
- **ABAC** — правила по атрибутам (время, регион, статус). Гибкий контекст, тяжелее аудировать.
- **ReBAC** — граф отношений (модель Google Zanzibar; SpiceDB, OpenFGA). Для «пошарить объект конкретному пользователю», вложенных групп, иерархий. Операционно тяжёл (нужен консистентный low-latency граф, «zookie»-токены).

**Три уровня прав (границы):**
1. **Admin/root IDP** — полный доступ к платформе (управление клиентами, ключами, аккаунтами). Для админ-консолей — обязательный фишинг-устойчивый MFA (FIDO2).
2. **Права сервисов-клиентов (scopes)** — что может запросить приложение-потребитель. Дизайн scopes: разделять по бизнес-области и чувствительности, hierarchical (`profile:read` / `profile:write`), read-only по умолчанию, write-суффикс только при необходимости, least privilege, first-party клиентам можно отключать consent-экран.
3. **Права пользователя над своим аккаунтом** — просмотр/отзыв согласий, список активных сессий и устройств, самостоятельный logout, управление MFA.

**Модерационные инструменты (как обычно реализовано):**
- **Блокировка аккаунта** — флаг статуса, при котором auth-путь отказывает.
- **Принудительный logout всех сессий** — удаление всех записей в сессионном сторе + отзыв всех refresh token family пользователя.
- **Ограничение по подозрению в компрометации** — reuse-detection refresh-токена → отзыв всего family; сравнение IP/device fingerprint с контекстом выпуска; step-up аутентификация (доп. фактор при подозрительном входе).

## Details
Ключевая архитектурная идея, применимая к любому IDP независимо от масштаба — **fast path vs slow path**. Быстрый путь (проверка сессии/токена, локальная валидация подписи JWT по опубликованному JWKS) не должен трогать «тяжёлую» БД профиля — иначе каждый запрос любого сервиса-потребителя будет упираться в неё. Медленный путь (чтение/обновление ПДн профиля, управление устройствами) идёт отдельно. Даже при единственной инстанции БД логическое разделение схем (core identity / credentials / profile / sessions / devices) стоит почти ничего и окупается при первом же росте нагрузки, когда часть таблиц уедет на реплики или в отдельный стор.

Ещё одна инвариантная идея — граница ответственности между IDP и сервисами-потребителями должна проходить по стабильному протокольному контракту (OIDC discovery + userinfo + scopes), а не по внутренней схеме данных. Это позволяет менять внутреннее хранение (в т.ч. вводить шардинг/реплики позже) без ломки клиентов.

## Практический стадийный ориентир (от MVP к масштабу)

**Базовый минимум для любого нового IDP (не зависит от масштаба):**
1. **Протокол:** Authorization Code + PKCE (S256) для всех клиентов; implicit/password grant не использовать. Точное совпадение redirect_uri. Публикация `/.well-known/openid-configuration` + JWKS; клиенты валидируют токены локально по JWKS.
2. **Токены:** access 10–15 мин; refresh 14–30 дней с rotation + reuse-detection (отзыв всего family); revocation endpoint (RFC 7009) на logout и смене пароля; `aud` на конкретный сервис.
3. **Хранение:** Argon2id (m≈19–46 MiB, t=2–3, p=1, с прицелом на ~100 мс верификации); refresh-токены и client_secret хранить хэшированными; PII шифровать at rest, ключи вне БД.
4. **Разделение путей в схеме БД:** логически разнести core identity / credentials / profile / sessions / devices с самого начала — дёшево и окупается при росте. Сессии — в лёгком in-memory/Redis-совместимом сторе с TTL.
5. **Права:** RBAC (admin/service/user) + строго ограниченные OAuth scopes на каждый сервис-потребитель.
6. **Модерация:** блокировка аккаунта, «выйти со всех устройств» (сброс сессий + отзыв refresh family), список активных сессий/устройств для пользователя.
7. **Комплаенс (для РФ):** локализация хранения ПДн; политика обработки ПДн; retention-политика; путь к необратимому удалению (crypto-shredding).
8. **MFA:** минимум TOTP; желательно закладывать WebAuthn/passkeys как опцию, особенно для админ-ролей.
9. **Audit log** всех security-событий (логины, отказы, отзывы, reuse-detection).

**Что имеет смысл откладывать до появления реальной нагрузки/сложности, а не внедрять заранее:**
- Шардирование по user_id, read replicas, отдельный кластер Redis — по метрикам, а не заранее.
- SAML 2.0 — только под конкретного enterprise-потребителя, требующего именно его.
- SCIM — когда сервисам-потребителям нужен автоматический провижининг/деинициализация аккаунтов, а не только логин.
- ReBAC/Zanzibar (OpenFGA/SpiceDB) — только при появлении per-object sharing.
- Sender-constrained токены (mTLS/DPoP) — при работе с особо чувствительными данными или high-value угрозами.
- FAPI-профили — при финансовых/особо регулируемых сценариях.

**Индикаторы, требующие пересмотра решений:**
- Auth-путь стабильно упирается в CPU/latency при верификации паролей → снизить memory_cost Argon2id или горизонтально масштабировать этот узел.
- Один primary по записи не справляется / рост до сотен тысяч активных пользователей → read replicas, затем шардирование по user_id.
- Появился внешний (не first-party) сервис-потребитель → полноценный consent-экран, ужесточение scope-review, возможно SCIM.
- Инциденты с уводом токенов → sender-constrained токены (DPoP), обязательный passkey для чувствительных ролей.

## Caveats
- **Внутренняя архитектура хранения/шардирования Google, Яндекс ID, VK ID, Т-ID, Сбер ID публично НЕ документирована** в их developer-доках. Конкретные паттерны («шардирование по user_id», «read replicas», «Redis для сессий», «разделение fast/slow path») взяты из общей инженерной литературы (Redis, system-design источники) и применимы как индустриальный стандарт, но не являются подтверждённым описанием именно их продакшена. Где данных нет — это отмечено явно.
- **VK ID:** детали OAuth 2.1/PKCE(S256), endpoint `id.vk.ru/authorize` и `/oauth2/user_info` подтверждены множеством согласующихся SDK и вторичных источников; часть глубоких бизнес-докдок VK на момент исследования были недоступны (техработы). Формулировка «legacy OAuth 2.0 прекратил работу 30.09.2025» точнее описывается как дедлайн миграции доменов vk.com → vk.ru.
- **Т-Банк ID** в процессе ребрендинга: официальные доки используют и `id.tinkoff.ru`, и `id.tbank.ru` — трактуйте как переходные/эквивалентные.
- **NIST SP 800-63-4** финализирована в июле 2025 и заменяет -63-3 (superseded с 1 августа 2025); при аудите сверяйтесь с актуальной ревизией.
- **Параметры Argon2id и сроки токенов** — ориентиры OWASP/RFC 9700 на 2025–2026; их всегда нужно калибровать под реальное железо конкретной системы.
