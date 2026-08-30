import { Icon, type IconName } from "@/design/Icon";
import type { SectionDescriptor, SectionProps } from "@/sections/types";

// Заглушка для разделов «в разработке». Заполнение = замена Work на реальный экран.
export function PlaceholderScreen({ label, icon }: { label: string; icon: IconName }) {
  return (
    <main className="zone zone-work">
      <div className="placeholder">
        <div className="ph-ico"><Icon name={icon} size={28} /></div>
        <b>{label}</b>
        <span>Раздел в разработке</span>
      </div>
    </main>
  );
}

/** Фабрика дескриптора-заглушки — добавить раздел можно одной строкой в registry. */
export function placeholderSection(id: string, label: string, icon: IconName): SectionDescriptor {
  const Work = (_: SectionProps) => <PlaceholderScreen label={label} icon={icon} />;
  return { id, label, icon, hasMetro: false, Work };
}
