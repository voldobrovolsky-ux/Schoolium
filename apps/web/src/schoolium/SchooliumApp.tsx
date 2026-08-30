/**
 * Корень контура Schoolium 1.1.1: карта сайта (AR-95) и оболочка (AR-81).
 *
 * Публичные маршруты показываются БЕЗ оболочки; маршруты приложения требуют
 * сессии, и аноним на них уходит на `/login?next=<путь>` — не на пустую
 * страницу и не в молчаливый редирект на корень.
 *
 * `/admin` целиком принадлежит модератору (AR-69): остальные роли получают
 * 403-экран с причиной.
 */
import "./tokens.css";
import "./app.css";
import { SessionProvider, useSession } from "./session";
import { isAppPath, navigate, useRoute } from "./router";
import { Shell } from "./shell";
import { Skeletons } from "./ui";
import { BootstrapScreen, JoinScreen, LandingScreen, LoginCodeScreen, LoginScreen, PhotoScreen } from "./screens/auth";
import { ClassScreen, ClassesScreen } from "./screens/classes";
import { SubjectsScreen } from "./screens/subjects";
import { StaffScreen } from "./screens/staff";
import { ScheduleScreen } from "./screens/schedule";
import { JournalScreen } from "./screens/journal";
import { AdminScreen, BindScreen, DevicesScreen, ScanScreen } from "./screens/misc";
import { GuardiansScreen } from "./screens/family";
import { DiaryScreen } from "./screens/diary";

export function SchooliumApp() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}

function Routes() {
  const route = useRoute();
  const { state } = useSession();
  const { path, params, query } = route;

  // Пока личность неизвестна — скелетоны той же геометрии, что и будущий
  // экран, а не спиннер по центру (§0).
  if (state.status === "loading") {
    return (
      <div className="sch" style={{ padding: "var(--sp-32)" }}>
        <Skeletons count={4} />
      </div>
    );
  }

  const authed = state.status === "authed";

  // ─── публичный контур входа: без оболочки (§2.3) ───
  if (path === "/join/:token") return <JoinScreen token={params.token} />;
  if (path === "/join/:token/photo") return <PhotoScreen />;
  if (path === "/bootstrap/:token") return <BootstrapScreen token={params.token} />;
  if (path === "/login") {
    // Вошедший на странице входа не смотрит на QR — он уже внутри (AR-95).
    if (authed) {
      navigate(state.me.startScreen);
      return null;
    }
    return <LoginScreen next={query.get("next")} />;
  }
  if (path === "/login/code") {
    if (authed) {
      navigate(state.me.startScreen);
      return null;
    }
    return <LoginCodeScreen />;
  }
  // Код входа, пришедший ссылкой из QR (В1). Вошедшему он не нужен — он уже
  // внутри, и второй вход по чужому коду тут был бы дырой, а не удобством.
  if (path === "/login/code/:code") {
    if (authed) {
      navigate(state.me.startScreen);
      return null;
    }
    return <LoginCodeScreen code={params.code} />;
  }
  if (path === "/") return <LandingScreen authed={authed} startScreen={authed ? state.me.startScreen : "/login"} />;

  // ─── маршруты приложения: сессия обязательна ───
  if (!isAppPath(path)) {
    // Неизвестный путь — не белый экран: человек возвращается туда, где он есть.
    navigate(authed ? state.me.startScreen : "/");
    return null;
  }
  if (!authed) {
    navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return null;
  }

  return <AppScreen path={path} params={params} query={query} />;
}

function AppScreen({
  path,
  params,
  query,
}: {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}) {
  switch (path) {
    case "/classes":
      return (
        <Shell active="classes" title="Классы">
          <ClassesScreen />
        </Shell>
      );
    case "/classes/:classId":
    case "/classes/:classId/student/:studentId":
      return (
        <Shell active="classes" title="Класс" breadcrumb={{ label: "Классы", to: "/classes", current: "класс" }}>
          <ClassScreen classId={params.classId} />
        </Shell>
      );
    case "/subjects":
      return (
        <Shell active="subjects" title="Предметы">
          <SubjectsScreen />
        </Shell>
      );
    case "/subjects/:subjectId":
      return (
        <Shell active="subjects" title="Предметы" breadcrumb={{ label: "Предметы", to: "/subjects", current: "карточка" }}>
          <SubjectsScreen openId={params.subjectId} />
        </Shell>
      );
    case "/diary":
      // Кабинет ученика и родителя (AR-158): своя раскладка без пятивкладочной
      // оболочки — те вкладки ведут в 403, а не в его работу.
      return <DiaryScreen />;
    case "/guardians":
      return (
        <Shell active="staff" title="Родители">
          <GuardiansScreen />
        </Shell>
      );
    case "/guardians/:guardianId":
      return (
        <Shell active="staff" title="Родители">
          <GuardiansScreen openId={params.guardianId} />
        </Shell>
      );
    case "/staff":
      return (
        <Shell active="staff" title="Персонал">
          <StaffScreen />
        </Shell>
      );
    case "/staff/:personId":
      return (
        <Shell active="staff" title="Персонал" breadcrumb={{ label: "Персонал", to: "/staff", current: "карточка" }}>
          <StaffScreen openId={params.personId} />
        </Shell>
      );
    case "/schedule":
      return (
        <Shell active="schedule" title="Расписание">
          <ScheduleScreen />
        </Shell>
      );
    case "/journal":
      return (
        <Shell active="journal" title="Журнал">
          <JournalScreen classId={query.get("classId")} subjectId={query.get("subjectId")} />
        </Shell>
      );
    case "/admin":
      return (
        <Shell active="admin" title="Кабинет модератора">
          <AdminScreen />
        </Shell>
      );
    case "/scan":
      return (
        <Shell active="" title="Сканер">
          <ScanScreen />
        </Shell>
      );
    case "/settings/devices":
      return (
        <Shell active="" title="Устройства и сессии">
          <DevicesScreen />
        </Shell>
      );
    // ─── маршруты QR-ссылок (В1) ───
    case "/link/:token":
      return (
        <Shell active="" title="Подключение устройства">
          <DevicesScreen linkToken={params.token} />
        </Shell>
      );
    case "/bind/:token":
      return (
        <Shell active="" title="Привязка к предмету">
          <BindScreen token={params.token} />
        </Shell>
      );
    default:
      // Путь с префиксом приложения, но без экрана — тот же возврат к своему
      // стартовому экрану, что и для неизвестного пути.
      navigate("/classes");
      return null;
  }
}
