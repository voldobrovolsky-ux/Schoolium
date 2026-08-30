import type { CSSProperties, ReactNode } from "react";

// Минимальный outline-набор иконок (Lucide-style), перенесён из дизайн-референса 1:1.
export type IconName =
  | "dot" | "home" | "workspace" | "personalize" | "journal" | "pp" | "ktp"
  | "materials" | "mm" | "analytics" | "notes" | "calendar" | "presentation"
  | "conspect" | "test" | "control" | "eye" | "share" | "print" | "info"
  | "plus" | "generator" | "wrench" | "clipboardGen" | "chevDown" | "search"
  | "bell" | "mic" | "gear" | "sun" | "moon" | "check" | "x" | "alert"
  | "user" | "chevLeft" | "chevRight" | "palette" | "clock" | "phone"
  | "monitor" | "schedule" | "flame" | "storage" | "bot";

interface IconProps {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 22, strokeWidth = 1.75, style, className }: IconProps) {
  const P = ICON_PATHS[name] ?? ICON_PATHS.dot;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {P}
    </svg>
  );
}

const ICON_PATHS: Record<string, ReactNode> = {
  dot: <circle cx="12" cy="12" r="3" />,
  home: (
    <>
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.2 9.4V20a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1V9.4" />
      <path d="M9.6 21v-6.2h4.8V21" />
    </>
  ),
  workspace: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  personalize: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  journal: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v15.5a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 0 5 21" />
      <path d="M5 4.5V19" />
      <path d="M9 8h7M9 11.5h7" />
    </>
  ),
  pp: (
    <>
      <path d="M8 4h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M9.5 9.5l1.3 1.3 2.2-2.4" />
      <path d="M9.5 15.5l1.3 1.3 2.2-2.4" />
    </>
  ),
  ktp: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="12" r="2.2" />
      <path d="M7 8.2v7.6" />
      <path d="M9.2 6.6c4 .4 5.6 2 5.9 5.2" />
    </>
  ),
  materials: (
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.2h6.5A1.5 1.5 0 0 1 19 9.7v7.8A1.5 1.5 0 0 1 17.5 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />
  ),
  mm: (
    <>
      <path d="M12 3.5 21 8l-9 4.5L3 8Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 16.8 12 21l9-4.2" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7.5" y="12" width="3" height="5" rx="1" />
      <rect x="13.5" y="8" width="3" height="9" rx="1" />
    </>
  ),
  notes: (
    <>
      <path d="M16.5 3.6 20.4 7.5 8.4 19.5l-4.4 1 1-4.4Z" />
      <path d="M14.5 5.6 18.4 9.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2.5" />
      <path d="M4 9.5h16" />
      <path d="M8 3.5v3.5M16 3.5v3.5" />
      <path d="M8 13h2M14 13h2M8 17h2" />
    </>
  ),
  presentation: (
    <>
      <rect x="3.5" y="4" width="17" height="11" rx="2" />
      <path d="M12 15v4" />
      <path d="M8.5 19.5 12 17l3.5 2.5" />
    </>
  ),
  conspect: (
    <>
      <path d="M6 3.5h7.5L18.5 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13 3.5V8h4.5" />
      <path d="M8 12h6M8 15.5h6" />
    </>
  ),
  test: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.2 12.2l2.2 2.2 4.4-4.8" />
    </>
  ),
  control: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5a3 3 0 0 1 6 0" />
      <path d="M9.5 12h5M9.5 15.5h3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="17.5" cy="6" r="2.4" />
      <circle cx="17.5" cy="18" r="2.4" />
      <path d="M8.1 10.9 15.4 7.1M8.1 13.1l7.3 3.8" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V4h10v5" />
      <path d="M7 18H5.5A1.5 1.5 0 0 1 4 16.5V11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="15" width="10" height="5.5" rx="1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  generator: (
    <>
      <path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5 10.4 11.1 6 9.5l4.4-1.6Z" />
      <path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
    </>
  ),
  wrench: (
    <path d="M15.5 7.5a4 4 0 0 1-5.2 5.2L5.5 17.5a1.8 1.8 0 0 1-2.5-2.5l4.8-4.8a4 4 0 0 1 5.2-5.2l-2.6 2.6 1.9 1.9Z" />
  ),
  clipboardGen: (
    <>
      <rect x="5.5" y="5" width="13" height="16" rx="2" />
      <path d="M9 5a3 3 0 0 1 6 0" />
      <path d="M12 10v6M9 13h6" />
    </>
  ),
  chevDown: <path d="m6 9 6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M9 21h6" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6" />
    </>
  ),
  moon: <path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 8.5v5" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  chevLeft: <path d="m14 6-6 6 6 6" />,
  chevRight: <path d="m10 6 6 6-6 6" />,
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 2-2 0-1.5 1-2 2.2-2H18a3 3 0 0 0 3-3c0-4.7-4-7-9-7Z" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M10.5 18h3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  schedule: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2.5" />
      <path d="M4 9.5h16M8 3.5v3.5M16 3.5v3.5" />
      <path d="M8.5 13h7M8.5 16.5h4" />
    </>
  ),
  flame: (
    <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.6.7-2.8 1.5-3.6C9.8 9.6 10 11 11 11.5 11 9 12 6.5 12 3Z" />
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 4.5V8M8.5 13h.01M15.5 13h.01M9.5 16.5h5" />
      <path d="M2.5 12.5v2M21.5 12.5v2" />
    </>
  ),
};
