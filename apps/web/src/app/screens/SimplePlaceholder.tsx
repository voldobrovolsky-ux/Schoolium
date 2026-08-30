import { Icon, type IconName } from "@/design/Icon";

// Полноэкранная заглушка для разделов левой навигации (Главная/Расписание/…).
export function SimplePlaceholder({ label, icon }: { label: string; icon: IconName }) {
  return (
    <div className="placeholder" style={{ height: "100%" }}>
      <div className="ph-ico"><Icon name={icon} size={28} /></div>
      <b>{label}</b>
      <span>Раздел в разработке</span>
    </div>
  );
}
