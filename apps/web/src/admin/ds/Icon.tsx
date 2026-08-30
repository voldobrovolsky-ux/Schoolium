import {
  Building2, Users, CreditCard, Plug, BarChart3, Database, Monitor, Laptop, Tablet,
  Smartphone, Wifi, WifiOff, QrCode, Link2Off, Plus, MapPin, Hash, Image, Clock, Globe,
  Shield, ScanLine, Lock, LogIn, KeyRound, Check, X, Eye, User, UserCog, UserX, Search,
  Filter, RotateCcw, Power, Wallet, Package, Calendar, MessageCircle, FileText, Sparkles,
  Printer, HardDrive, Settings, Send, Repeat, CalendarClock, Download, History, ChevronRight,
  ChevronDown, GraduationCap, Pencil, Trash2, Circle, CircleAlert, CircleCheck, Layers,
  House, BookOpen, ClipboardList, LineChart, HeartPulse, CalendarDays, GalleryVerticalEnd,
  Mic, ArrowRight, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

// Lucide (2px stroke) — иконографика дизайн-системы EduStore. Имена в kebab-case.
const MAP: Record<string, LucideIcon> = {
  "building-2": Building2, users: Users, "credit-card": CreditCard, plug: Plug,
  "bar-chart-3": BarChart3, database: Database, monitor: Monitor, laptop: Laptop,
  tablet: Tablet, smartphone: Smartphone, wifi: Wifi, "wifi-off": WifiOff, "qr-code": QrCode,
  "link-2-off": Link2Off, plus: Plus, "map-pin": MapPin, hash: Hash, image: Image, clock: Clock,
  globe: Globe, shield: Shield, "scan-line": ScanLine, lock: Lock, "log-in": LogIn,
  "key-round": KeyRound, check: Check, x: X, eye: Eye, user: User, "user-cog": UserCog,
  "user-x": UserX, search: Search, filter: Filter, "rotate-ccw": RotateCcw, power: Power,
  wallet: Wallet, package: Package, calendar: Calendar, "message-circle": MessageCircle,
  "file-text": FileText, sparkles: Sparkles, printer: Printer, "hard-drive": HardDrive,
  settings: Settings, send: Send, repeat: Repeat, "calendar-clock": CalendarClock,
  download: Download, history: History, "chevron-right": ChevronRight, "chevron-down": ChevronDown,
  "graduation-cap": GraduationCap, pencil: Pencil, "trash-2": Trash2, circle: Circle,
  "circle-alert": CircleAlert, "circle-check": CircleCheck, layers: Layers,
  home: House, book: BookOpen, clipboard: ClipboardList, "line-chart": LineChart,
  "heart-pulse": HeartPulse, "calendar-days": CalendarDays, ktp: GalleryVerticalEnd,
  mic: Mic, "arrow-right": ArrowRight, "shield-check": ShieldCheck,
};

export type IconName = keyof typeof MAP;

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  className,
  color,
}: {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
}) {
  const C = MAP[name] ?? Circle;
  return <C size={size} strokeWidth={strokeWidth} className={className} color={color} />;
}
