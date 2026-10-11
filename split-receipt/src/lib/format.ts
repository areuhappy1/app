import type { BankAccount, SettlementResult } from "./types";
import { accountText, isUsableAccount } from "./toss";

/** 원 단위 콤마 포맷 ("1,234원") */
export function formatWon(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 콤마만 ("1,234") */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

/** 단톡방에 그대로 붙여넣을 수 있는 정돈된 텍스트 */
export function buildKakaoText(
  result: SettlementResult,
  options: { title?: string; accounts?: Record<string, BankAccount>; shareUrl?: string } = {}
): string {
  const { title, accounts = {}, shareUrl } = options;
  const lines: string[] = [];
  lines.push(`🧾 ${title || "모임"} 정산 결과`);
  lines.push("────────────────");
  lines.push(`총 지출: ${formatWon(result.totalSpent)}`);
  lines.push(`참석 인원: ${result.people.length}명`);
  lines.push(`1인당 평균: ${formatWon(result.averagePerPerson)}`);
  lines.push("");

  if (result.expenses.length > 0) {
    lines.push("📋 세부 내역");
    for (const exp of result.expenses) {
      const payerText = exp.payers.map((p) => p.name).join(", ") || "-";
      lines.push(`• ${exp.title} ${formatWon(exp.total)} (결제: ${payerText})`);
    }
    lines.push("");
  }

  lines.push("💸 이렇게만 송금하면 끝!");
  if (result.transfers.length === 0) {
    lines.push("- 정산할 금액이 없어요 (이미 딱 맞음)");
  } else {
    for (const t of result.transfers) {
      lines.push(`- ${t.from} ➡️ ${t.to} : ${formatWon(t.amount)}`);
    }
  }

  const receivers = Array.from(new Set(result.transfers.map((t) => t.to)));
  const accountLines = receivers.flatMap((name) => {
    const acc = accounts[name];
    return isUsableAccount(acc) ? [`- ${name}: ${accountText(acc)}`] : [];
  });
  if (accountLines.length > 0) {
    lines.push("");
    lines.push("🏦 받는 계좌");
    lines.push(...accountLines);
  }

  if (shareUrl) {
    lines.push("");
    lines.push("👇 영수증 보고 토스로 바로 보내기");
    lines.push(shareUrl);
  }

  return lines.join("\n");
}
