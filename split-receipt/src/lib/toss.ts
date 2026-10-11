import type { BankAccount } from "./types";

/**
 * 토스 송금 딥링크의 bank 파라미터에 들어가는 한글 은행 코드.
 * 토스가 공식 목록을 공개하지 않아, 토스 송금 QR이 만드는 값과 같은 짧은 이름을 쓴다.
 */
export const BANKS: { code: string; label: string }[] = [
  { code: "토스", label: "토스뱅크" },
  { code: "카카오", label: "카카오뱅크" },
  { code: "국민", label: "KB국민" },
  { code: "신한", label: "신한" },
  { code: "우리", label: "우리" },
  { code: "하나", label: "하나" },
  { code: "농협", label: "NH농협" },
  { code: "기업", label: "IBK기업" },
  { code: "케이", label: "케이뱅크" },
  { code: "새마을", label: "새마을금고" },
  { code: "우체국", label: "우체국" },
  { code: "SC제일", label: "SC제일" },
  { code: "신협", label: "신협" },
  { code: "수협", label: "Sh수협" },
  { code: "부산", label: "부산" },
  { code: "대구", label: "iM뱅크(대구)" },
  { code: "경남", label: "경남" },
  { code: "광주", label: "광주" },
  { code: "전북", label: "전북" },
  { code: "제주", label: "제주" },
  { code: "씨티", label: "씨티" },
  { code: "산업", label: "KDB산업" },
];

export function isKnownBank(code: string): boolean {
  return BANKS.some((b) => b.code === code);
}

export function bankLabel(code: string): string {
  return BANKS.find((b) => b.code === code)?.label ?? code;
}

export function cleanAccountNumber(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** 계좌번호로 볼 수 있는 최소 요건 (은행별 자릿수가 달라 길이만 본다) */
export function isUsableAccount(account: BankAccount | undefined): account is BankAccount {
  return !!account && isKnownBank(account.bank) && account.number.length >= 8;
}

/** "토스뱅크 100012345678" */
export function accountText(account: BankAccount): string {
  return `${bankLabel(account.bank)} ${account.number}`;
}

export function buildTossLink(account: BankAccount, amount: number): string {
  const params = [
    `amount=${Math.round(amount)}`,
    `bank=${encodeURIComponent(account.bank)}`,
    `accountNo=${account.number}`,
    "origin=qr",
  ];
  return `supertoss://send?${params.join("&")}`;
}

/** 토스 앱을 열 수 있는 환경인지 (데스크톱에서는 스킴이 아무 반응이 없다) */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
