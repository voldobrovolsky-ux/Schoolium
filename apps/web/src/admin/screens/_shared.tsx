import type { ReactNode } from "react";

export function WorkHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="adm-work__head">
      <div>
        <h1 className="adm-work__title">{title}</h1>
        {sub && <div className="adm-work__sub">{sub}</div>}
      </div>
      {actions && <div className="adm-work__actions">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={"adm-panel" + (className ? " " + className : "")} style={style}>{children}</div>;
}
