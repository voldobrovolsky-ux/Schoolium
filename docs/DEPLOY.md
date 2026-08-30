# Деплой на VPS (РФ)

## Schoolium 1.2.0 — первый запуск школы

Кратчайший путь «чистый VPS → школа, в которой можно работать». Всё остальное в
этом файле — вытесняемый контур (Флёрус OIDC, голосовой ввод); для 1.2.0 оно не
нужно и по умолчанию не поднимается.

```bash
git clone <repo> schoolium && cd schoolium
git checkout claude/schoolium-foundation-architecture-6jqc6q
cp .env.prod.example .env.prod && $EDITOR .env.prod   # POSTGRES_PASSWORD, SITE_DOMAIN, WEB_ORIGIN

# стек: postgres + api + web + Caddy(авто-SSL). ASR не собирается.
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile caddy up -d --build

# завести школу и оператора (роли admin+moderator) — печатает одноразовую
# ссылку входа на 24 часа И резервные креды (юзернейм+пароль, один раз)
docker compose -f docker-compose.prod.yml exec api \
  npm run school:bootstrap -- --phone=+79990000000 --school="Школа №17" --name="Иванова Мария"
```

Миграции применяются сами при старте контейнера (`prisma migrate deploy`), сида
для 1.2.0 нет и не нужно: школа заводится командой выше, всё остальное вводит
оператор с экранов.

Ссылку из последней команды отдать оператору школы, креды — записать и хранить
отдельно: это резервный вход `/login`, если сессия слетит (AR-156). Дальше
оператор идёт по онбордингу сам: классы → предметы → персонал (именные QR) →
ученики и родители (S-13/S-14) → привязка педагогов → настройка расписания →
автогенерация → журнал. Экран «не авторизованные» (S-32) показывает, кто ещё
не отсканировал свой QR.

### Предзаполнение данными школы (`school:import`)

Разовая заливка вместо ручного ввода с экранов: классы с учениками, учётки,
родители со связями, персонал, предметы с привязками, четверти. Данные —
`school-data.json` из конвертера (в git не лежит: ПДн; санминимум АР-155 —
только ФИО, класс, связи, телефоны).

```bash
scp school-data.json user@сервер:~/schoolium/
docker compose -f docker-compose.prod.yml cp school-data.json api:/tmp/school-data.json
docker compose -f docker-compose.prod.yml exec api \
  npm run school:import -- --workspace=<id из school:bootstrap> --data=/tmp/school-data.json
docker compose -f docker-compose.prod.yml cp api:/tmp/school-import-creds.txt ./  # креды всех учёток, один раз
```

`--dry-run` показывает объём без записи; спорные строки исходника скрипт
пропускает и перечисляет (добавляются `--include-disputed` или с экранов).
Файл кредов после передачи владельцу удалить с сервера.

### Три места, где деплой ломается молча

| Что | Симптом | Как не наступить |
|---|---|---|
| `WEB_ORIGIN` не совпадает с реальным адресом | `school:bootstrap` печатает ссылку на чужой домен — модератор не входит | Заполнить `WEB_ORIGIN` **до** первого прогона bootstrap |
| Стенд без TLS (по IP) | Вход проходит, но возвращает на форму: браузер не сохраняет `secure`-cookie | Поднять с доменом и Caddy. Если TLS сегодня нет — вариант В ниже (`WEB_BIND`/`WEB_PORT`/`COOKIE_INSECURE` вместе), **только для демо, не с данными живой школы** |
| Порт 80/443 занят хостовым nginx | Caddy не стартует | Вариант А ниже: без `--profile caddy`, фронт-дверь — хостовый nginx |

### Вариант В — без домена, показать сегодня по IP

Домена ещё нет, а показать нужно сейчас. Без Caddy (ему для сертификата нужен
домен), сервисы `web` идёт наружу напрямую:

```bash
# .env.prod, вместо https-строки:
WEB_ORIGIN=http://<IP-сервера>
WEB_BIND=0.0.0.0
WEB_PORT=80
COOKIE_INSECURE=1

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Без `--profile caddy` — он тут не участвует. Как только появится домен: убрать
`WEB_BIND`/`WEB_PORT`/`COOKIE_INSECURE`, вернуть `WEB_ORIGIN` на `https://`,
поднять с `--profile caddy` — данные и школа никуда не денутся, это те же
контейнеры и тот же том `pgdata`.

### Что уже работает в этой версии

Десктоп и телефон, PWA (иконкой на рабочий стол). Онбординг школы целиком,
расписание с проверкой СанПиН, журнал: календарь недель, отметки, средний балл
за четверть и выходящая четвертная. Сверх 1.1.1 — инкремент «запуск школы»
(specs/school-launch/): девять ролей и права v2 (админ / модератор-КПЦ /
завуч-УТЦ), учётки с юзернеймом и паролем, вход `/login` как фолбэк слетевшей
сессии, именные QR для персонала, учеников и родителей (скан — и сразу в
кабинете, без единого поля ввода), отзыв активации, экран «не авторизованные»
(S-32), карточки родителей со связями с детьми (S-14), дневник и успеваемость
для родителя и ученика (S-90/S-91), пресет предметов РФ одной кнопкой (S-23).

Чего нет и что добавляется инкрементами: домашнее задание и файлы (инкремент
№2 — Документохранилище, КТП, КПП, ММ), рейтинг сверх средних баллов, ссылки-
приглашения, перенос учёток на Флёрус (контракт готов — specs/school-launch/
10-identity.md §8). Полный список отложенного — `specs/school-launch/00-scope.md` §4.

### Снести код и передеплоить заново (тот же сервер)

Отдельно от переноса на другой сервер — если нужно просто выбросить папку с
кодом на этом же VPS и клонировать заново (например, начать с чистого
рабочего дерева после ручных правок в консоли). База — в именованном томе
Docker (`pgdata`), а не в папке с кодом, поэтому школа, директор, завуч и все
данные это переживают **при условии, что не трогаете сам том**.

```bash
cd ~ && rm -rf schoolium              # только папка с кодом — контейнеры и том не трогает
git clone <repo> schoolium && cd schoolium && git checkout claude/schoolium-foundation-architecture-6jqc6q
cp ~/.env.prod .env.prod              # ваш прежний .env.prod, не пример — в нём пароль от той же базы
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Ключевое: **сохраните свой `.env.prod` до `rm -rf`** — он не в git (специально,
там пароль от базы) и живёт только на диске. Потеряете файл — потеряете пароль
от уже существующей базы, а не только настройки. Скопируйте его куда-нибудь
(`cp .env.prod ~/.env.prod.backup`) прямо сейчас, до любых чисток.

Если вместо простого «снести и клонировать» нужно **удалить и данные тоже**
(например, начать с пустой базы) — это отдельная, необратимая команда
(`docker compose down -v`), и её стоит делать осознанно, не заодно с чисткой
кода.

### Перенос стенда на другой сервер

**Всё состояние версии 1.1.1 — это одна база Postgres.** Контур `schoolium` не
обращается к файловому хранилищу ни разу: загрузок нет, документы и учебники
принадлежат вытесняемому контуру и версии 1.1.2. Поэтому перенос — это перенос
дампа, а не сервера: ни образов, ни томов, ни путей на диске тащить не нужно.

Забрать со старого сервера нужно ровно два предмета: **дамп базы** и
**`.env.prod`**. Сертификат TLS не переносится — Caddy выпустит новый сам, как
только DNS будет смотреть на новый адрес.

```bash
# 1. На СТАРОМ сервере — снять дамп (школа в это время может работать)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > schoolium-$(date +%F).dump

# 2. Перенести дамп и .env.prod на новый сервер
scp schoolium-*.dump .env.prod user@новый-сервер:~/

# 3. На НОВОМ сервере — поднять стек и залить дамп
git clone <repo> schoolium && cd schoolium && git checkout claude/schoolium-foundation-architecture-6jqc6q
cp ~/.env.prod .   # правим только SITE_DOMAIN и WEB_ORIGIN, если домен меняется
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile caddy up -d --build

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < ~/schoolium-*.dump

# 4. Перевести A-запись DNS на новый IP
```

Между шагами 1 и 4 школа не может вносить данные — всё, что введут после снятия
дампа, потеряется. Поэтому дамп снимается **последним действием**, вечером или в
выходной, а не за день до переезда.

#### Если база уезжает во внешний сервис (managed Postgres)

Это не перенос, а смена одной строки. Убрать сервис `postgres` и его `depends_on`
из `docker-compose.prod.yml`, заменить `DATABASE_URL` у `api` на строку
подключения провайдера, залить туда тот же дамп тем же `pg_restore`. Миграции
накатятся при старте контейнера, как и раньше.

Требование одно: **база должна быть в РФ** — в ней персональные данные детей
(152-ФЗ). Managed Postgres у российских провайдеров этому удовлетворяет,
зарубежный — нет.

#### Сколько нужно железа

Работать 1.1.1 будет и на минимальном тарифе: школа на 300 учеников — это
десятки мегабайт в базе. Узкое место не работа, а **сборка**: `docker compose
up --build` собирает два образа, каждый со своим `npm install` (~400 МБ
зависимостей) и компиляцией TypeScript. На 2 ГБ RAM это иногда падает по
нехватке памяти.

Лечится один раз и заранее:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Диска хватает 20 ГБ: образы ~1.5 ГБ, база растёт медленно. Сервис `asr` не
поднимается (профиль `asr`) — именно он требовал бы кратно больше.

---

## Вытесняемый контур: полный стек EduStore

Стек на одном сервере: **reverse-proxy** (443, TLS) → **web** (nginx: SPA + проксирование
`/api`) → **api** (NestJS+Prisma) → **postgres**; плюс **asr** (faster-whisper). Домен:
`edustore-flor-group.ru`.

Фронт-дверь — на выбор:
- **Вариант А — хостовый nginx** (если nginx уже стоит на сервере): он держит 80/443 и TLS,
  а compose публикует web/api **только на `127.0.0.1`**. Caddy не запускаем. Конфиг —
  `deploy/nginx/edustore.conf`.
- **Вариант Б — встроенный Caddy** (чистый VPS без своего nginx): авто-SSL, запускается профилем
  `--profile caddy`.

> Порты api/web публикуются только на loopback (`127.0.0.1:3000`, `127.0.0.1:8080`) — наружу их
> отдаёт reverse-proxy с TLS. Прямо в интернет контейнеры не торчат.

## 0. Предусловия
- VPS в РФ (Yandex Cloud / VK / Selectel — реестр/152-ФЗ), Ubuntu 22.04+, 2–4 vCPU / 4–8 ГБ.
- DNS: `A`-запись `edustore-flor-group.ru` → IP сервера.
- Docker + Docker Compose v2: `curl -fsSL https://get.docker.com | sh`.
- Открыты порты 80, 443 (их слушает reverse-proxy: хостовый nginx или Caddy).

## 1. Код и переменные
```bash
git clone <repo> edustore && cd edustore
cp .env.prod.example .env.prod   # затем заполнить (см. ниже)
```

`.env.prod` (минимум):
```bash
POSTGRES_USER=edustore
POSTGRES_PASSWORD=<сильный-пароль>
POSTGRES_DB=edustore
ASR_MOCK=0                       # 1 — без модели (демо); 0 — реальный faster-whisper
# Флёрус (ADR-0005) — после регистрации клиента
FLOR_ISSUER=https://accounts.flor-group.ru
FLOR_CLIENT_ID=edustore
FLOR_CLIENT_SECRET=<секрет из регистрации>
```

## 2. Запуск

**Вариант А — хостовый nginx** (рекомендуется, если nginx уже стоит):
```bash
# 1) поднять стек (web→127.0.0.1:8080, api→127.0.0.1:3000; Caddy не стартует)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 2) настроить nginx как фронт-дверь (один upstream на web-контейнер)
sudo cp deploy/nginx/edustore.conf /etc/nginx/sites-available/edustore.conf
sudo ln -s /etc/nginx/sites-available/edustore.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d edustore-flor-group.ru      # TLS-сертификат
sudo nginx -t && sudo systemctl reload nginx
```
Хостовый nginx проксирует ВСЁ на `127.0.0.1:8080` (web-контейнер сам отдаёт SPA и `/api`).
Это и чинит 502: до этого nginx бил в `localhost:3000`, который не был опубликован наружу.

**Вариант Б — встроенный Caddy** (чистый VPS, авто-SSL):
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile caddy up -d --build
```

Миграции применяются автоматически (`prisma migrate deploy` в CMD api).

Первый деплой — засеять демо-структуру (опционально, для проверки кабинетов):
```bash
docker compose -f docker-compose.prod.yml exec api npm run seed
```

## 3. Проверка
```bash
# из контейнера/локально (loopback): API жив
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/auth/flor/me   # 401 без сессии — норм
# снаружи через домен: SPA + API за прокси
curl -s -o /dev/null -w "%{http_code}\n" https://edustore-flor-group.ru/api/auth/flor/me  # 401 — норм
# открыть https://edustore-flor-group.ru — лендинг; «Войти» → вход через Флёрус
```

**Проверка редиректа по роли** (после входа должен открыться нужный кабинет):
```bash
docker compose -f docker-compose.prod.yml logs api | grep "provision"
# provision sub=… role=admin org=… florus_orgs=1   → откроется кабинет администратора
```
Если `role=teacher` и `florus_orgs=0` — Флёрус не отдаёт роли: проверьте, что у клиента `edustore`
включены scope `flor:org`/`flor:roles`, а вы добавлены в орг с ролью `admin` (онбординг §6).

## 4. Обновление
```bash
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 5. Что ещё понадобится (по мере подключения)
- **S3** (Yandex Object Storage) для файлов/учебников — env `S3_*` (когда появится файлохранилище).
- **AI-ключи** (YandexGPT/DeepSeek) для генерации КТП/материалов — env, маршрутизация по 152-ФЗ
  (см. план тестирования/персонализации).
- **Регистрация Флёрус-клиента** (`edustore`) с redirect `https://edustore-flor-group.ru/api/auth/flor/callback`
  и backchannel `…/api/auth/flor/backchannel-logout` (ADR-0005 §регистрация).
- **Бэкапы Postgres**: `pg_dump` по cron (том `pgdata`).

## Заметки
- ASR в проде: `ASR_MOCK=0` тянет модель faster-whisper при старте (или смонтируйте предзагруженную
  в `services/asr/models`). CPU достаточно для коротких фраз (см. INFRA.md).
- Dockerfile'ы рассчитаны на сборку из корня монорепо (workspaces). Валидируйте первую сборку на сервере.
