/**
 * Заведение учётки модератором (AR-154): ФИО + юзернейм + пароль. Одна форма на
 * три вида карточек (персонал / ученик / родитель) — правила не расходятся.
 *
 * Юзернейм предзаполняется транслитерацией ФИО и правится; занятость
 * проверяется вживую. Пароль по умолчанию генерирует сервер — поле оставляют
 * пустым; ответ сервера показывает креды ОДИН раз (`CredentialsBox`).
 */
import { useEffect, useRef, useState } from "react";
import { usernameFromFio, usernameProblem, type CredentialsDto, type FillStaffCardDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { Button, Field } from "../ui";

export function AccountForm({
  fio,
  submitLabel,
  onSubmit,
  testPrefix,
}: {
  /** ФИО уже известны (доступ ученика) — поля не показываются. */
  fio?: { lastName: string; firstName: string; middleName?: string | null };
  submitLabel: string;
  onSubmit: (dto: FillStaffCardDto) => Promise<void>;
  testPrefix: string;
}) {
  const [form, setForm] = useState({
    lastName: fio?.lastName ?? "",
    firstName: fio?.firstName ?? "",
    middleName: fio?.middleName ?? "",
    username: "",
    password: "",
  });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [free, setFree] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checkTimer = useRef<number | undefined>(undefined);

  // предзаполнение транслитерацией, пока модератор не начал править сам
  const suggested = form.lastName && form.firstName ? usernameFromFio(form.lastName, form.firstName) : "";
  const username = usernameTouched ? form.username : suggested;

  useEffect(() => {
    setFree(null);
    if (!username || usernameProblem(username)) return;
    window.clearTimeout(checkTimer.current);
    checkTimer.current = window.setTimeout(() => {
      api
        .usernameFree(username)
        .then((r) => setFree(r.free))
        .catch(() => setFree(null));
    }, 300);
    return () => window.clearTimeout(checkTimer.current);
  }, [username]);

  const problem = username ? usernameProblem(username) : null;
  const usernameHint =
    problem === "invalid"
      ? "строчные латинские буквы, цифры и подчёркивание, 3–30 знаков"
      : problem === "reserved"
        ? "это имя зарезервировано"
        : free === false
          ? "занят — выберите другой"
          : free === true
            ? "свободен"
            : "предзаполнен по ФИО, можно изменить";

  const ready = form.lastName.trim() && form.firstName.trim() && username && !problem && free !== false;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        username,
        password: form.password.trim() || null,
      });
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Не получилось");
      setBusy(false);
    }
  };

  return (
    <div className="sch-stack">
      {fio ? null : (
        <>
          <Field
            label="Фамилия"
            testId={`${testPrefix}.input.lastName`}
            value={form.lastName}
            autoCapitalize="words"
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <Field
            label="Имя"
            testId={`${testPrefix}.input.firstName`}
            value={form.firstName}
            autoCapitalize="words"
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <Field
            label="Отчество"
            hint="при наличии"
            testId={`${testPrefix}.input.middleName`}
            value={form.middleName}
            autoCapitalize="words"
            onChange={(e) => setForm({ ...form, middleName: e.target.value })}
          />
        </>
      )}
      <Field
        label="Юзернейм"
        hint={usernameHint}
        testId={`${testPrefix}.input.username`}
        value={username}
        autoCapitalize="none"
        autoComplete="off"
        onChange={(e) => {
          setUsernameTouched(true);
          setForm({ ...form, username: e.target.value.toLowerCase() });
        }}
        error={error}
      />
      <Field
        label="Пароль"
        hint="пустое поле — пароль сгенерируется"
        testId={`${testPrefix}.input.password`}
        value={form.password}
        autoComplete="new-password"
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <div className="sch-actions">
        <Button kind="primary" testId={`${testPrefix}.btn.submit`} disabled={!ready} loading={busy} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Креды, показанные один раз (AR-156): пароль сервер больше не отдаст — только
 * перевыпустит. Модератор диктует или переписывает их человеку как резерв.
 */
export function CredentialsBox({ credentials, note }: { credentials: CredentialsDto; note?: string }) {
  return (
    <div className="sch-canvas" data-testid="credentials.box" style={{ padding: "var(--sp-16)" }}>
      <p style={{ margin: 0 }}>
        Юзернейм: <strong data-testid="credentials.username">{credentials.username}</strong>
        <br />
        Пароль: <strong data-testid="credentials.password" style={{ letterSpacing: "0.08em" }}>{credentials.password}</strong>
      </p>
      <p className="sch-muted" style={{ marginBottom: 0 }}>
        {note ?? "Пароль показан один раз — это резервный вход, основной вход по QR. Потеряется — перевыпустите на карточке."}
      </p>
    </div>
  );
}
