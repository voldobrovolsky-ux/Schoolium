import { QRCodeSVG } from "qrcode.react";

// Логотип EduStore (мантия выпускника) для центра QR — компактный data-URI SVG.
const LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="#2563EB"/>' +
      '<path d="M32 17 L53 27 L32 37 L11 27 Z" fill="#fff"/>' +
      '<path d="M20 31 v8 c0 4 24 4 24 0 v-8" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M53 27 v11" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>' +
      '<circle cx="53" cy="40.5" r="2.6" fill="#fff"/>' +
      "</svg>",
  );

/** Крупный читаемый QR на белой карточке (контраст сохраняется и в тёмной теме). */
export function EduQR({ value, size = 280 }: { value: string; size?: number }) {
  const logo = Math.round(size * 0.22);
  return (
    <div className="eduqr" style={{ width: size + 32, height: size + 32 }}>
      <QRCodeSVG
        value={value}
        size={size}
        level="H"
        bgColor="#ffffff"
        fgColor="#0C0F15"
        imageSettings={{ src: LOGO, width: logo, height: logo, excavate: true }}
      />
    </div>
  );
}
