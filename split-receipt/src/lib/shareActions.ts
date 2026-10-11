import { toBlob } from "html-to-image";
import { copyText } from "./clipboard";
import { isMobileDevice } from "./toss";

export type ShareOutcome = "shared" | "copied" | "downloaded" | "cancelled" | "failed";

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** 휴대폰이면 공유 시트(카톡 선택)로, 아니면 링크가 담긴 텍스트를 복사한다. */
export async function shareLink(title: string, text: string, url: string): Promise<ShareOutcome> {
  if (isMobileDevice() && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
    }
  }
  return (await copyText(`${text}\n${url}`)) ? "copied" : "failed";
}

/** 영수증을 PNG로 만들어 휴대폰이면 이미지째 공유하고, 아니면 내려받는다. */
export async function shareReceiptImage(node: HTMLElement, title: string): Promise<ShareOutcome> {
  const blob = await toBlob(node, { pixelRatio: 3, cacheBust: true });
  if (!blob) return "failed";

  const date = new Date().toISOString().slice(0, 10);
  const fileName = `${title || "정산"}_영수증_${date}.png`.replace(/[\\/:*?"<>|\s]+/g, "_");
  const file = new File([blob], fileName, { type: "image/png" });

  if (isMobileDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${title || "모임"} 정산 영수증` });
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
