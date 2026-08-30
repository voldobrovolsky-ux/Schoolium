import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Персонализация: дизайн-токены переключаются атрибутами на <html> (см. styles.css).
export type Theme = "light" | "dark";
export type Density = "compact" | "standard" | "spacious";
export type Anim = "fast" | "standard" | "slow" | "none";

export interface Prefs {
  theme: Theme;
  density: Density;
  anim: Anim;
  autoCollapse: boolean; // сворачивать левый сайдбар в рабочем пространстве
}

const DEFAULTS: Prefs = { theme: "light", density: "standard", anim: "standard", autoCollapse: true };
const KEY = "edustore-prefs";

interface PrefsCtx extends Prefs {
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", prefs.theme);
    r.setAttribute("data-density", prefs.density);
    r.setAttribute("data-anim", prefs.anim);
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  const set: PrefsCtx["set"] = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));

  return <Ctx.Provider value={{ ...prefs, set }}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePrefs must be used within PrefsProvider");
  return c;
}
