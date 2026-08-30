import { useEffect, useRef, useState } from "react";
import type { GradeValue, VoiceCandidate } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import { api, ApiError } from "@/lib/api";
import { VoiceRecorder } from "@/lib/audio";

type Phase = "recording" | "processing" | "disambig" | "confirm" | "error";

/**
 * Мобильный голосовой док — ОСНОВНОЙ способ ввода оценок на телефоне.
 * Реальная запись → ASR (constrained vocab) → дизамбигуация → подтверждение.
 * Мягкая деградация при отсутствии микрофона/ASR.
 */
export function MVoice({
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
  const [grade, setGrade] = useState<GradeValue>("");
  const [transcript, setTranscript] = useState("");
  const [candidates, setCandidates] = useState<VoiceCandidate[]>([]);
  const [chosen, setChosen] = useState<VoiceCandidate | null>(null);
  const [error, setError] = useState("");
  const recRef = useRef<VoiceRecorder | null>(null);

  useEffect(() => {
    const rec = new VoiceRecorder();
    recRef.current = rec;
    rec.start().catch(() => {
      setError("Микрофон недоступен");
      setPhase("error");
    });
    return () => rec.cancel();
  }, []);

  async function recognize() {
    const rec = recRef.current;
    if (!rec) return;
    setPhase("processing");
    try {
      const audio = await rec.stop();
      const res = await api.voiceGrade({ audio, classId, lessonId });
      setTranscript(res.transcript);
      setGrade(res.grade);
      setCandidates(res.candidates);
      if (!res.grade || res.candidates.length === 0) {
        setError("Не распознано");
        setPhase("error");
      } else if (res.candidates.length === 1) {
        setChosen(res.candidates[0]);
        setPhase("confirm");
      } else {
        setPhase("disambig");
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? "Сервис распознавания недоступен" : "Ошибка распознавания");
      setPhase("error");
    }
  }

  return (
    <div className="m-voice">
      <div className="m-voice-row">
        <div className="m-voice-mic"><Icon name="mic" size={20} style={{ color: "#fff" }} /></div>
        <div className="m-voice-body">
          {phase === "recording" ? (
            <>
              <div className="m-voice-status"><span className="voice-live-dot" /> Слушаю…</div>
              <div className="m-voice-text">Назовите оценку и фамилию</div>
            </>
          ) : phase === "processing" ? (
            <><div className="m-voice-status">Распознаю…</div><div className="m-voice-text">{transcript || "…"}</div></>
          ) : phase === "error" ? (
            <><div className="m-voice-status">Не получилось</div><div className="m-voice-text">{error}</div></>
          ) : phase === "disambig" ? (
            <><div className="m-voice-status">Уточните ученика</div><div className="m-voice-text">«{transcript}»</div></>
          ) : (
            <><div className="m-voice-status">Распознано</div><div className="m-voice-text">{chosen?.name} → {grade}</div></>
          )}
        </div>
        <button className="voice-x" onClick={onCancel}><Icon name="x" size={18} /></button>
      </div>

      {phase === "recording" && (
        <div className="m-voice-actions">
          <button className="m-voice-cancel" onClick={onCancel}><Icon name="x" size={16} /> Отмена</button>
          <button className="m-voice-ok" onClick={recognize}><Icon name="check" size={16} /> Готово</button>
        </div>
      )}

      {phase === "disambig" && (
        <div className="m-voice-actions" style={{ flexWrap: "wrap" }}>
          {candidates.map((c) => (
            <button
              key={c.studentId}
              className="m-voice-cancel"
              style={{ flex: "1 1 45%" }}
              onClick={() => { setChosen(c); setPhase("confirm"); }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {phase === "confirm" && (
        <div className="m-voice-actions">
          <button className="m-voice-cancel" onClick={onCancel}><Icon name="x" size={16} /> Отменить</button>
          <button className="m-voice-ok" onClick={() => chosen && onConfirm(chosen.studentId, grade)}>
            <Icon name="check" size={16} /> Подтвердить
          </button>
        </div>
      )}

      {phase === "error" && (
        <div className="m-voice-actions">
          <button className="m-voice-cancel" onClick={onCancel}>Закрыть</button>
        </div>
      )}
    </div>
  );
}
