"""
EduStore ASR microservice — голосовой ввод оценок.

Транскрибирует короткие русские реплики учителя (например, "пять Иванову")
для функции голосового выставления оценок. Стек: FastAPI + faster-whisper
(CTranslate2), CPU-only, int8.

Mock-режим (ASR_MOCK=1 или faster-whisper недоступен): сервис стартует и
отвечает без загрузки модели — удобно для dev/CI и демо без скачивания
многогигабайтной модели.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import tempfile
import threading
from math import exp
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("asr")
logging.basicConfig(level=logging.INFO)

# --- Конфигурация из окружения ---------------------------------------------

# Размер модели faster-whisper (tiny/base/small/medium/large-v3).
ASR_MODEL: str = os.getenv("ASR_MODEL", "small")
# Принудительный mock-режим: не грузим модель, отдаём канонический ответ.
ASR_MOCK_ENV: bool = os.getenv("ASR_MOCK", "0") == "1"

# Канонический ответ mock-режима (полезен для демо голосового ввода).
MOCK_TEXT = "пять Иванову"
MOCK_CONFIDENCE = 0.92
LANGUAGE = "ru"


# --- Ленивая, защищённая загрузка faster-whisper ----------------------------
# Импорт faster-whisper делаем лениво и в try/except, чтобы /health работал,
# даже если библиотека/модель недоступны (тогда форсируем mock).

_model = None  # type: ignore[var-annotated]  # ленивый singleton WhisperModel
_model_lock = threading.Lock()
_mock_forced = False  # стало True, если загрузка модели провалилась


def _whisper_available() -> bool:
    """Установлен ли faster-whisper (без загрузки модели)."""
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:  # ImportError и любые ошибки окружения
        return False


def is_mock() -> bool:
    """Активен ли mock-режим: явно через env, либо из-за недоступности модели."""
    return ASR_MOCK_ENV or _mock_forced or not _whisper_available()


def get_model():
    """
    Лениво создаёт и кеширует WhisperModel (CPU, int8) один раз.

    При любой ошибке загрузки навсегда переключается в mock-режим и
    возвращает None — сервис продолжает работать (мягкая деградация).
    """
    global _model, _mock_forced

    if ASR_MOCK_ENV or _mock_forced:
        return None

    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel

            logger.info("Загрузка модели faster-whisper '%s' (CPU, int8)…", ASR_MODEL)
            _model = WhisperModel(ASR_MODEL, device="cpu", compute_type="int8")
            logger.info("Модель '%s' загружена.", ASR_MODEL)
        except Exception as exc:  # модель не скачана / нет библиотеки / OOM
            logger.warning("Не удалось загрузить модель, mock-режим: %s", exc)
            _mock_forced = True
            _model = None
    return _model


# --- Pydantic-контракты -----------------------------------------------------


class TranscribeRequest(BaseModel):
    """Запрос на транскрибацию."""

    audio_base64: str = Field(
        ..., description="base64 байтов аудио (wav/webm/ogg/mp3)"
    )
    vocabulary: List[str] = Field(
        default_factory=list,
        description="Словарь-подсказка: фамилии/имена класса для биасинга",
    )


class TranscribeResponse(BaseModel):
    """Ответ транскрибации."""

    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    language: str = LANGUAGE


class HealthResponse(BaseModel):
    """Статус сервиса."""

    status: str
    model: str
    mock: bool


# --- Вспомогательные функции ------------------------------------------------


def build_initial_prompt(vocabulary: List[str], max_chars: int = 240) -> Optional[str]:
    """
    Строит initial_prompt из словаря (ростера класса) для биасинга
    распознавания под ограниченный словарь (constrained-vocabulary).

    Соединяет уникальные имена через запятую и обрезает по длине, чтобы
    подсказка оставалась короткой.
    """
    if not vocabulary:
        return None

    seen = set()
    items: List[str] = []
    for raw in vocabulary:
        name = (raw or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        items.append(name)

    if not items:
        return None

    prompt = ", ".join(items)
    if len(prompt) > max_chars:
        prompt = prompt[:max_chars].rsplit(",", 1)[0].strip()
    return prompt


def logprob_to_confidence(avg_logprob: float, no_speech_prob: float = 0.0) -> float:
    """
    Преобразует avg_logprob сегмента в уверенность 0..1 через exp(),
    штрафуя на вероятность тишины. Возвращает «вменяемое» значение.
    """
    conf = exp(avg_logprob)  # avg_logprob <= 0 → exp в (0, 1]
    conf *= 1.0 - max(0.0, min(1.0, no_speech_prob))
    return max(0.0, min(1.0, conf))


def _decode_audio(audio_base64: str) -> bytes:
    """Декодирует base64 в байты, бросает 400 при некорректных данных."""
    data = audio_base64.strip()
    # Убираем возможный data-URL префикс ("data:audio/wav;base64,...").
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Некорректный base64: {exc}")
    if not raw:
        raise HTTPException(status_code=400, detail="Пустые аудиоданные")
    return raw


def _mock_response() -> TranscribeResponse:
    """Детерминированный ответ mock-режима."""
    return TranscribeResponse(
        text=MOCK_TEXT, confidence=MOCK_CONFIDENCE, language=LANGUAGE
    )


def transcribe_audio(req: TranscribeRequest) -> TranscribeResponse:
    """
    Основная логика транскрибации. Вынесена из эндпоинта, чтобы её можно
    было вызывать напрямую (тесты/CI) без поднятия HTTP-сервера.
    """
    # 1. Mock-режим — модель не трогаем.
    if is_mock():
        return _mock_response()

    model = get_model()
    if model is None:  # загрузка провалилась → деградация в mock
        return _mock_response()

    # 2. Декодируем и пишем во временный файл (faster-whisper читает с диска).
    raw = _decode_audio(req.audio_base64)
    initial_prompt = build_initial_prompt(req.vocabulary)

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        segments, info = model.transcribe(
            tmp_path,
            language=LANGUAGE,
            beam_size=5,
            initial_prompt=initial_prompt,
        )

        # 3. Склеиваем сегменты и усредняем уверенность по ним.
        parts: List[str] = []
        confidences: List[float] = []
        for seg in segments:
            parts.append(seg.text)
            confidences.append(
                logprob_to_confidence(
                    getattr(seg, "avg_logprob", -1.0),
                    getattr(seg, "no_speech_prob", 0.0),
                )
            )

        text = "".join(parts).strip()
        confidence = (
            sum(confidences) / len(confidences) if confidences else 0.0
        )
        language = getattr(info, "language", LANGUAGE) or LANGUAGE
        return TranscribeResponse(
            text=text, confidence=round(confidence, 4), language=language
        )
    except HTTPException:
        raise
    except Exception as exc:  # ошибка распознавания → 500 с понятным текстом
        logger.exception("Ошибка транскрибации")
        raise HTTPException(status_code=500, detail=f"Ошибка ASR: {exc}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# --- FastAPI-приложение -----------------------------------------------------

app = FastAPI(
    title="EduStore ASR",
    description="Голосовой ввод оценок (RU) на faster-whisper.",
    version="0.1.0",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Проверка живости. Работает всегда, даже без faster-whisper."""
    return HealthResponse(status="ok", model=ASR_MODEL, mock=is_mock())


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(req: TranscribeRequest) -> TranscribeResponse:
    """Транскрибирует короткую русскую реплику в текст."""
    return transcribe_audio(req)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
