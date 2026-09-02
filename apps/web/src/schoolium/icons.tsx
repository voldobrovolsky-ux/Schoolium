/**
 * Иконки Schoolium (AR-190): один источник — `lucide-react`, один размер на
 * место применения, один толщина линии. До 1.3.0 навигация и кнопки носили
 * юникод-глифы (▣ ◈ ☰ ⚙ ⛶ ✕): они рендерятся системным шрифтом, разной
 * толщины и разного размера на каждой платформе — интерфейс выглядел
 * собранным из подручного. Глиф здесь — дефект, а не стиль.
 *
 * Правила:
 *   · размеры — три: 18 (в кнопке с текстом), 20 (навигация, кнопка-иконка),
 *     24 (таб-бар мобайла); `strokeWidth` 1.75 всюду;
 *   · иконка не несёт смысла одна: рядом подпись либо `aria-label`;
 *   · иконка ничего не украшает — стоит там, где помогает найти или узнать.
 */
import type { ComponentType, SVGProps } from "react";
import {
  Activity,
  AlertTriangle,
  Apple,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  KeyRound,
  Laptop,
  LayoutDashboard,
  Link2,
  ListChecks,
  Lock,
  LogOut,
  Minus,
  Monitor,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserCog,
  Users,
  Wifi,
  X,
} from "lucide-react";

export type IconName =
  | "activity"
  | "alert"
  | "apple"
  | "android"
  | "back"
  | "verified"
  | "journal"
  | "school"
  | "calendar"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "checklist"
  | "copy"
  | "download"
  | "external"
  | "doc"
  | "student"
  | "key"
  | "laptop"
  | "dashboard"
  | "link"
  | "tasks"
  | "lock"
  | "logout"
  | "minus"
  | "monitor"
  | "network"
  | "collapse"
  | "expand"
  | "plus"
  | "printer"
  | "qr"
  | "refresh"
  | "scan"
  | "search"
  | "settings"
  | "shield"
  | "shieldAlert"
  | "shieldCheck"
  | "phone"
  | "trash"
  | "staff"
  | "users"
  | "wifi"
  | "close"
  | "classes"
  | "subjects";

type Lucide = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

/**
 * Android без фирменного логотипа: платформа узнаётся по подписи рядом, а
 * иконка — нейтральный смартфон. Бренд-марки Google в `lucide` нет намеренно.
 */
const ICONS: Record<IconName, Lucide> = {
  activity: Activity,
  alert: AlertTriangle,
  apple: Apple,
  android: Smartphone,
  back: ArrowLeft,
  verified: BadgeCheck,
  journal: BookOpen,
  school: Building2,
  calendar: CalendarDays,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  checklist: ClipboardList,
  copy: Copy,
  download: Download,
  external: ExternalLink,
  doc: FileText,
  student: GraduationCap,
  key: KeyRound,
  laptop: Laptop,
  dashboard: LayoutDashboard,
  link: Link2,
  tasks: ListChecks,
  lock: Lock,
  logout: LogOut,
  /* «−» шаговой кнопки: парная к `plus`, та же толщина линии — глиф «−» из
     системного шрифта был тоньше и ниже соседнего «+» (AR-190). */
  minus: Minus,
  monitor: Monitor,
  network: Network,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  plus: Plus,
  printer: Printer,
  qr: QrCode,
  refresh: RefreshCw,
  scan: ScanLine,
  search: Search,
  settings: Settings,
  shield: Shield,
  shieldAlert: ShieldAlert,
  shieldCheck: ShieldCheck,
  phone: Smartphone,
  trash: Trash2,
  staff: UserCog,
  users: Users,
  wifi: Wifi,
  close: X,
  classes: Users,
  subjects: BookOpen,
};

export type IconSize = 18 | 20 | 24;

export function Icon({ name, size = 20, className }: { name: IconName; size?: IconSize; className?: string }) {
  const C = ICONS[name];
  return <C className={className ? `sch-icon ${className}` : "sch-icon"} size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}
