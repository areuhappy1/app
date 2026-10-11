/**
 * 정산 도메인 타입 정의
 */

/** 한 지출 항목의 결제자 1명 (여러 명이 나눠 결제했을 수 있음) */
export interface Payer {
  name: string;
  /** 이 결제자가 실제로 낸 금액(원) */
  amount: number;
}

/** 파서가 추출한 하나의 지출 항목 */
export interface Expense {
  /** 지출 항목명 (예: "1차 고깃집", "숙소비") */
  title: string;
  /** 총 지출 금액(원) */
  total: number;
  /** 결제자 목록 (각자 낸 금액). 합계는 total과 같아야 한다. */
  payers: Payer[];
  /** 이 지출을 n분의 1로 나눠 부담할 참여자 명단 */
  participants: string[];
}

/** 한 사람의 순잔액 요약 */
export interface Balance {
  name: string;
  /** 낸 돈 합계 */
  paid: number;
  /** 부담해야 할 돈 합계 */
  owed: number;
  /** 순잔액 = paid - owed. 양수면 받을 돈, 음수면 보낼 돈 */
  net: number;
}

/** 송금 받을 계좌. bank는 토스 딥링크에 쓰는 은행 코드(예: "국민", "토스") */
export interface BankAccount {
  bank: string;
  /** 숫자만 */
  number: string;
}

/** 최소 송금 경로 한 건 */
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** 정산 전체 결과 */
export interface SettlementResult {
  expenses: Expense[];
  balances: Balance[];
  transfers: Transfer[];
  /** 전체 참여자 명단 (등장 순서 유지) */
  people: string[];
  /** 총 지출액 */
  totalSpent: number;
  /** 1인당 평균 지출액 (반올림) */
  averagePerPerson: number;
}
