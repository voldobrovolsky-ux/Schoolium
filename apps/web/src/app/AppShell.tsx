import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { NotificationDto, TeacherClass, TeacherProfile } from "@edustore/shared";
import { api } from "@/lib/api";
import { Icon } from "@/design/Icon";
import { usePrefs } from "@/app/prefs";
import { NAV_SECTIONS } from "@/app/nav";
import { LeftSidebar } from "@/app/LeftSidebar";
import { TopPanel } from "@/app/TopPanel";
import { RightSidebar } from "@/app/RightSidebar";
import { SECTIONS, DEFAULT_SECTION, getSection } from "@/sections/registry";
import type { SectionContext, SectionDescriptor, ToastInput } from "@/sections/types";
import { ToastStack, type Toast } from "@/components/Toasts";
import { NotificationPanel } from "@/components/NotificationPanel";
import { Personalize } from "@/app/screens/Personalize";
import { ScheduleScreen } from "@/app/screens/ScheduleScreen";
import { SimplePlaceholder } from "@/app/screens/SimplePlaceholder";
import { useIsMobile } from "@/mobile/useIsMobile";
import { MobileApp } from "@/mobile/MobileApp";

let TOAST_SEQ = 0;

export function AppShell() {
  const { autoCollapse } = usePrefs();
  const isMobileViewport = useIsMobile();
  const [deviceOverride, setDeviceOverride] = useState<"auto" | "desktop" | "mobile">("auto");

  const [nav, setNav] = useState("workspace");
  const [workSection, setWorkSection] = useState(DEFAULT_SECTION);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [activeClass, setActiveClass] = useState<TeacherClass | null>(null);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
    api.getNotifications().then(setNotifications).catch(() => {});
    api
      .getClasses()
      .then((cs) => {
        setClasses(cs);
        setActiveClass(cs.find((c) => c.label === "8А") ?? cs[0] ?? null);
      })
      .catch(() => {});
  }, []);

  const removeToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((t: ToastInput) => {
    const id = ++TOAST_SEQ;
    setToasts((ts) => [...ts, { ...t, id }]);
    if (t.type !== "urgent") setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const ctx: SectionContext = { assignment: activeClass, pushToast, searchQuery };

  const mobile = deviceOverride === "auto" ? isMobileViewport : deviceOverride === "mobile";
  const framedMobile = deviceOverride === "mobile" && !isMobileViewport;
  const descriptor = getSection(workSection);

  let body: ReactNode;
  let overlays: ReactNode = null;

  if (mobile) {
    body = <MobileApp framed={framedMobile} />;
  } else if (nav === "personalize") {
    body = (
      <div className="app">
        <LeftSidebar active={nav} onSelect={setNav} expanded profile={profile} />
        <div className="middle"><Personalize /></div>
      </div>
    );
  } else if (nav === "schedule") {
    body = (
      <div className="app">
        <LeftSidebar active={nav} onSelect={setNav} expanded profile={profile} />
        <div className="middle"><ScheduleScreen /></div>
      </div>
    );
  } else if (nav !== "workspace") {
    const item = NAV_SECTIONS.find((s) => s.id === nav)!;
    body = (
      <div className="app">
        <LeftSidebar active={nav} onSelect={setNav} expanded profile={profile} />
        <div className="middle"><SimplePlaceholder label={item.label} icon={item.icon} /></div>
      </div>
    );
  } else {
    body = (
      <div className="app">
        <LeftSidebar active={nav} onSelect={setNav} expanded={!autoCollapse} profile={profile} />
        <div className="middle">
          <TopPanel
            classes={classes}
            activeClassId={activeClass?.classId ?? null}
            onSelectClass={setActiveClass}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onBell={() => setNotifOpen(true)}
            notifCount={notifications.length}
          />
          <div className="middle-row">
            <SectionShell
              key={workSection + ":" + (activeClass?.id ?? "")}
              descriptor={descriptor}
              ctx={ctx}
              active={workSection}
              onSelectSection={setWorkSection}
            />
          </div>
        </div>
      </div>
    );
    overlays = notifOpen && (
      <NotificationPanel items={notifications} onClose={() => setNotifOpen(false)} pushToast={pushToast} />
    );
  }

  return (
    <div className="viewport">
      {body}
      {overlays}
      <ToastStack toasts={toasts} remove={removeToast} />
      <DeviceSwitch mobile={mobile} onChange={(m) => setDeviceOverride(m ? "mobile" : "desktop")} />
    </div>
  );
}

// Переключатель «десктоп / телефон» — предпросмотр мобильной версии на десктопе.
function DeviceSwitch({ mobile, onChange }: { mobile: boolean; onChange: (mobile: boolean) => void }) {
  return (
    <div className="device-switch">
      <button className={!mobile ? "on" : ""} onClick={() => onChange(false)} title="Десктоп"><Icon name="monitor" size={17} /></button>
      <button className={mobile ? "on" : ""} onClick={() => onChange(true)} title="Мобильная версия"><Icon name="phone" size={17} /></button>
    </div>
  );
}

const PassThrough = ({ children }: { ctx: SectionContext; children: ReactNode }) => <>{children}</>;

/**
 * Композирует зоны раздела: общий провайдер оборачивает Nav (зона 2), Work (зона 3)
 * и правый сайдбар (зона 4) — так Nav/Work/RightTools делят состояние раздела.
 */
function SectionShell({
  descriptor,
  ctx,
  active,
  onSelectSection,
}: {
  descriptor: SectionDescriptor;
  ctx: SectionContext;
  active: string;
  onSelectSection: (id: string) => void;
}) {
  const Provider: ComponentType<{ ctx: SectionContext; children: ReactNode }> = descriptor.Provider ?? PassThrough;
  const { Nav, Work, RightTools } = descriptor;
  return (
    <Provider ctx={ctx}>
      {descriptor.hasMetro && Nav && <Nav ctx={ctx} />}
      <Work ctx={ctx} />
      <RightSidebar sections={SECTIONS} active={active} onSelect={onSelectSection}>
        {RightTools && <RightTools ctx={ctx} />}
      </RightSidebar>
    </Provider>
  );
}
