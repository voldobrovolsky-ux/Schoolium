import { useEffect, useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Button } from "@/admin/ds/components";
import { deviceApi } from "./deviceApi";

type St = { kind: "pending" } | { kind: "ok"; name: string } | { kind: "fail"; msg: string };

/**
 * Подтверждение привязки устройства с телефона: открывается по ссылке из QR
 * (/?bind=CODE) у авторизованного пользователя. Шлёт код на сервер — киоск,
 * который показывал QR, тут же получает device-токен и уходит в режим входа.
 */
export function BindConfirm({ code }: { code: string }) {
  const [st, setSt] = useState<St>({ kind: "pending" });

  useEffect(() => {
    let alive = true;
    deviceApi
      .bind(code)
      .then((r) => alive && setSt({ kind: "ok", name: r.deviceName }))
      .catch((e: Error) =>
        alive && setSt({ kind: "fail", msg: e.message === "HTTP 404" ? "Код не найден или истёк" : "Не удалось привязать" }),
      );
    return () => {
      alive = false;
    };
  }, [code]);

  const home = () => window.location.assign("/");

  return (
    <div className="eds-admin home">
      <div className="bc">
        <div className="bc-card">
          {st.kind === "pending" && (
            <>
              <span className="bc-ico bc-ico--wait">
                <Icon name="scan-line" size={28} />
              </span>
              <h2>Привязываем устройство…</h2>
              <p>Секунду — подтверждаем код {code}.</p>
            </>
          )}
          {st.kind === "ok" && (
            <>
              <span className="bc-ico bc-ico--ok">
                <Icon name="circle-check" size={28} />
              </span>
              <h2>Устройство привязано</h2>
              <p>
                <b>{st.name}</b> добавлено в сеть школы. На том компьютере уже открылся экран входа.
              </p>
              <Button variant="create" icon={<Icon name="arrow-right" size={16} />} onClick={home}>
                В кабинет
              </Button>
            </>
          )}
          {st.kind === "fail" && (
            <>
              <span className="bc-ico bc-ico--fail">
                <Icon name="circle-alert" size={28} />
              </span>
              <h2>Не получилось</h2>
              <p>{st.msg}. Сгенерируйте новый код на компьютере и попробуйте снова.</p>
              <Button variant="secondary" onClick={home}>
                В кабинет
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
