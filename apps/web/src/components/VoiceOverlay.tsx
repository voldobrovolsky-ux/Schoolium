import { useEffect, useRef, useState } from "react";
import type { GradeValue, VoiceCandidate } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import { api, ApiError } from "@/lib/api";
import { VoiceRecorder } from "@/lib/audio";

type Phase = "recording" | "processing" | "disambig" | "confirm" | "error";

/**
 * Голосовой ввод оценки. Реальный контур: запись → ASR (constrained vocab) →
 * парсинг «оценка + ФИО» → дизамбигуация однофамильцев → подтверждение.
 * Мягкая деградация: нет микрофона/ASR недоступен → понятное сообщение, журнал
 * продолжает работать вручную.
 */
export function VoiceOverlay({
  classId,
  lessonId,
  onConfirm,
  onCancel,
}: {
  classId: string;
  lessonId: string;
  onConfirm: (studentId: string, grade: GradeValue) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("recording");
  const [transcript, setTranscript] = useState("");
  const [grade, setGrade] = useState<GradeValue>("");
  const [candidates, setCandidates] = useState<VoiceCandidate[]>([]);
  const [chosen, setChosen] = useState<VoiceCandidate | null>(null);
  const [error, setError] = useState("");
  const recRef = useRef<VoiceRecorder | null>(null);

  // старт записи при открытии
  useEffect(() => {
    const rec = new VoiceRecorder();
    recRef.current = rec;
    rec.start().catch(() => {
      setError("Микрофон недоступен. Выставите оценку вручную.");
      setPhase("error");
    });
    return () => rec.cancel();
  }, []);

  async function stopAndRecognize() {
    const rec = recRef.current;
    if (!rec) return;
    setPhase("processing");
    try {
      const audio = await rec.stop();
      const res = await api.voiceGrade({ audio, classId, lessonId });
      setTranscript(res.transcript);
      setGrade(res.grade);
      setCandidates(res.candidates);
      if (res.candidates.length === 0 || !res.grade) {
        setError("Не удалось распознать. Повторите или введите вручную.");
        setPhase("error");
      } else if (res.candidates.length === 1) {
        setChosen(res.candidates[0]);
        setPhase("confirm");
      } else {
        setPhase("disambig");
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 503
          ? "Сервис распознавания недоступен. Введите оценку вручную."
          : "Ошибка распознавания. Введите оценку вручную.",
      );
      setPhase("error");
    }
  }

  const pick = (c: VoiceCandidate) => {
    setChosen(c);
    setPhase("confirm");
  };
  const confirm = () => chosen && onConfirm(chosen.studentId, grade);

  return (
    <div className="voice-scrim">
      <div className="voice-dock">
        <div className="voice-row">
          <div className={"voice-mic" + (phase === "recording" ? " live" : "")}>
            <Icon name="mic" size={24} style={{ color: "#fff" }} />
          </div>
          <div className="voice-body">
            {phase === "recording" ? (
              <>
                <div className="voice-status"><span className="voice-live-dot" /> Слушаю…</div>
                <div className="voice-wave">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: i * 80 + "ms" }} />
                  ))}
                </div>
              </>
            ) : phase === "processing" ? (
              <>
                <div className="voice-status">Распознаю…</div>
                <div className="voice-text vt-muted">{transcript || "…"}</div>
              </>
            ) : phase === "error" ? (
              <>
                <div className="voice-status">Не получилось</div>
                <div className="voice-text">{error}</div>
              </>
            ) : (
              <>
                <div className="voice-status">Распознано{transcript ? `: «${transcript}»` : ""}</div>
                <div className="voice-text">
                  {phase === "disambig" ? (
                    "Уточните ученика"
                  ) : (
                    <><span className="vt-muted">{chosen?.name} →</span> {grade}</>
                  )}
                </div>
              </>
            )}
          </div>
          {phase === "recording" ? (
            <button className="vc-btn vc-ok" onClick={stopAndRecognize} title="Готово">
              <Icon name="check" size={16} /> Готово
            </button>
          ) : (
            <button className="voice-x" onClick={onCancel} title="Закрыть"><Icon name="x" size={18} /></button>
          )}
        </div>

        {phase === "disambig" && (
          <div className="voice-disambig">
            <div className="vd-title">Найдено несколько учеников — выберите</div>
            <div className="vd-list">
              {candidates.map((c) => (
                <button key={c.studentId} className="vd-card" onClick={() => pick(c)}>
                  <b>{c.name}</b>
                  <span>{c.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "confirm" && (
          <div className="voice-confirm">
            <div className="vc-result">
              <span className="vc-name">{chosen?.name}</span>
              <span style={{ color: "#64748B" }}>→</span>
              <span className="vc-grade">{grade}</span>
            </div>
            <div className="vc-actions">
              <button className="vc-btn vc-cancel" onClick={onCancel}>
                <Icon name="x" size={16} /> Отменить
              </button>
              <button className="vc-btn vc-ok" onClick={confirm}>
                <Icon name="check" size={16} /> Подтвердить
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="voice-confirm">
            <div className="vc-result" />
            <div className="vc-actions">
              <button className="vc-btn vc-cancel" onClick={onCancel}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
