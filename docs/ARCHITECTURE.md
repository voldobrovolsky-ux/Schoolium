# EduStore — архитектура

Принцип: **модульный монолит с жёсткими границами**. Не микросервисы (соло-команда
не потянет ops), но и не «большой ком грязи» — каждый домен изолирован так, что
новый раздел/блок = быстрая имплементация, а не правка десяти мест.

## Монорепо

```
EduStore/
├── docs/                  # аудит, ADR, инфра
├── apps/
│   ├── api/               # NestJS + Prisma (модульный монолит)
│   └── web/               # React + TS + Vite (кабинет учителя)
├── services/
│   └── asr/               # faster-whisper (FastAPI, отдельный контейнер)
├── packages/
│   └── shared/            # общие TS-контракты (DTO/типы фронт↔бэк)
└── docker-compose.yml     # postgres + api + asr + web
```

Почему так: фронт и бэк на одном TS → общие типы в `packages/shared` (контракт
один, дрейфа нет). ASR — отдельный рантайм (Python), общается по HTTP за
анти-коррупционным фасадом `voice`-модуля.

## Backend (apps/api)

Каждый домен — самостоятельный NestJS-модуль с чёткими границами:

```
src/
├── main.ts
├── app.module.ts          # сборка: импортирует доменные модули
├── common/
│   ├── prisma/            # PrismaService (единая точка доступа к БД)
│   └── auth/              # заглушка Flōrus SSO → florus_user_id (DEV-guard)
└── modules/
    ├── teacher/           # классы и группы учителя
    ├── planning/          # уроки = «станции метро», детали урока, ДЗ
    ├── journal/           # CRUD оценок, сводка класса
    ├── voice/             # голосовой ввод → ASR → дизамбигуация
    ├── materials/         # сгенерированные материалы (скелет)
    ├── notes/             # устные заметки учителя (скелет)
    └── reports/           # автоотчёты (скелет)
```

**Правила границ (как в кабинетах из аудита):**
1. Модуль владеет своей логикой; межмодульные вызовы — только через публичные
   сервисы, не через чужие репозитории.
2. FK между доменами — по `id`, без жёсткой связности на уровне запросов.
3. Новый домен = папка `modules/<name>` (`*.module.ts` + `*.controller.ts` +
   `*.service.ts` + `dto/`) + одна строка в `app.module.ts`. Больше нигде.

## Frontend (apps/web) — реестр разделов

Сердце требования «новые разделы — быстрая имплементация». Прототип хранил
`WORKSPACE_SECTIONS` как массив и свитчил по `workSection`. Мы формализуем это в
**реестр**: каждый раздел — самодостаточный модуль, экспортирующий дескриптор.

```
src/
├── main.tsx
├── design/                # styles.css (дизайн-токены) + Icon
├── lib/                   # api-клиент, общие типы, хуки
├── app/
│   ├── AppShell.tsx       # 4 зоны, маршрутизация по реестру
│   ├── LeftSidebar.tsx
│   ├── RightSidebar.tsx
│   └── TopPanel.tsx
├── sections/
│   ├── registry.ts        # ← единственная точка регистрации разделов
│   ├── types.ts           # SectionDescriptor
│   ├── journal/           # WorkComponent + RightTools + icon
│   ├── planning/          # WorkComponent (+ metro) + RightTools
│   └── _placeholder/      # для незаполненных разделов
└── components/            # VoiceOverlay, Notifications, Metro, Toasts
```

### Как добавить новый раздел (3 шага)

```ts
// 1. sections/analytics/index.tsx
import type { SectionDescriptor } from "../types";
export const analyticsSection: SectionDescriptor = {
  id: "analytics",
  label: "Аналитика",
  icon: "analytics",
  Work: AnalyticsScreen,          // центральный экран (зона 3)
  RightTools: AnalyticsTools,     // нижний блок правого сайдбара (опц.)
  hasMetro: false,                // показывать ли зону 2 (метро)
};

// 2. sections/registry.ts
import { analyticsSection } from "./analytics";
export const SECTIONS = [journalSection, planningSection, analyticsSection /*…*/];

// 3. готово — AppShell сам отрисует иконку в правом сайдбаре,
//    переключение, анимацию и нужные зоны.
```

Никаких правок в `AppShell`, роутере или сайдбарах. Дескриптор описывает, какие
зоны нужны разделу (`hasMetro`), что в центре (`Work`) и что в инструментах
(`RightTools`). Аналогично можно расширять `LeftSidebar` через `NAV_SECTIONS`.

### Зоны UI (по референсу)

```
[ Zone 1: левый сайдбар ] [ Zone 2: метро ] [ Zone 3: рабочий экран ] [ Zone 4: правый сайдбар ]
   84px / 214px (collapse)   208px (опц.)        flex                     208px
```

Дизайн-токены — в `design/styles.css` (`:root` light + `[data-theme=dark]` +
плотность `[data-density]` + анимации `[data-anim]`). Все цвета/отступы/тени —
переменные; персонализация = смена атрибутов на `<html>`.

## Голосовой ввод (контур данных)

```
[Web] MediaRecorder → base64
   → POST /api/voice/grade { audio, classId, lessonId }
   → [api voice-модуль] → HTTP → [asr faster-whisper] (constrained vocab = список класса)
   → { studentId?, candidates[], grade, confidence }
   → дизамбигуация однофамильцев в UI → confirm → POST /api/journal/grade (source=VOICE)
```

ASR изолирован: если контейнер недоступен, журнал работает (ручной ввод) —
голос деградирует мягко.

## Что отложено (скелеты)
`materials`, `notes`, `reports`, разделы КТП/ММ/Аналитика — модули/дескрипторы
заведены и возвращают заглушки, чтобы добавление было дозаполнением, а не стройкой.

См. также: [ADR](./adr/) — ключевые архитектурные решения.
