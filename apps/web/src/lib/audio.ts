/** Захват короткой аудиозаписи через MediaRecorder и кодирование в base64 для ASR. */
export class VoiceRecorder {
  private media?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.media = new MediaRecorder(this.stream);
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.media.start();
  }

  /** Останавливает запись и возвращает base64 (без data: префикса). */
  stop(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.media) return reject(new Error("recorder not started"));
      this.media.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: this.media?.mimeType });
          resolve(await blobToBase64(blob));
        } catch (e) {
          reject(e);
        } finally {
          this.stream?.getTracks().forEach((t) => t.stop());
        }
      };
      this.media.stop();
    });
  }

  cancel(): void {
    try {
      this.media?.stop();
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
