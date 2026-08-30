/**
 * «Водяной» оверлей перехода между режимами: расходящаяся волна с искажением
 * через SVG-фильтр (feTurbulence + feDisplacementMap). Включается на ~0.78с при
 * смене режима. При отсутствии поддержки SMIL остаётся мягкая радиальная волна.
 */
export function WaterOverlay({ show }: { show: boolean }) {
  return (
    <div className={"home-water" + (show ? " is-on" : "")} aria-hidden>
      <div className="home-water__layer" />
      <svg className="home-water__defs" width="0" height="0">
        <defs>
          <filter id="eds-water" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.02"
              numOctaves="2"
              seed="7"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                dur="0.78s"
                values="0.012 0.02; 0.03 0.05; 0.012 0.02"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="44"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
