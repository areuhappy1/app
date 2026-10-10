/**
 * 브라우저 내장 OCR (tesseract.js). 서버/외부 API 없이 클라이언트에서만 동작.
 * 언어 데이터(kor/eng)는 최초 1회 CDN에서 자동 다운로드된다.
 *
 * tesseract.js는 브라우저 전용(Worker/Blob 사용)이라 반드시 동적 import로
 * 불러와 SSR 단계에서 실행되지 않도록 한다.
 */
export async function runOcr(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // OCR 엔진·언어 데이터는 앱에 포함해(self-host) 외부 CDN 없이 동작시킨다.
  // (네트워크가 제한된 환경에서도 작동하고, CDN 장애의 영향을 받지 않음)
  const worker = await createWorker("kor+eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/",
    langPath: "/tesseract/lang",
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return cleanupOcrText(data.text);
  } finally {
    await worker.terminate();
  }
}

/**
 * OCR 결과를 파서가 읽기 좋게 가볍게 다듬는다.
 * - 공백만 있는 줄 제거
 * - 과도한 공백 축소
 * - 숫자 사이에 끼어든 공백(예: "3 0 만") 보정은 과하면 오히려 해로우므로 생략
 */
function cleanupOcrText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
