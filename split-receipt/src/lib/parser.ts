import type { Expense, Payer } from "./types";

/**
 * 규칙/정규식 기반 정산 메모 파서.
 *
 * 설계 원칙
 *  - 한 줄 = 한 지출 항목 (줄바꿈으로 분리). 단, 한 줄 안에서 "/"로 구분된
 *    참여자 섹션 등은 함께 해석한다.
 *  - 괄호 () 안의 내용은 "결제자 그룹" 또는 "참여자 그룹"으로 분류한다.
 *  - 금액은 한국어 단위(만/억/천/원)와 콤마 숫자를 모두 인식한다.
 *
 * 반환은 Expense[]. UI 쪽에서 payers 합계와 total이 다르면 경고할 수 있도록
 * 가능한 많은 정보를 보존한다.
 */

const PAYER_KEYWORD = /결제|결재|계산|냄|쏨|paid/i;
const PARTICIPANT_KEYWORD = /참여자|참석자|참석|멤버|인원|명단/;
const NAME_SPLIT = /[,\n、·&+/]+|및|그리고|\band\b/gi;

export interface AmountMatch {
  value: number;
  index: number;
  length: number;
  raw: string;
}

/**
 * 문자열에서 금액 후보들을 찾는다.
 * - 단위(만/억/천)나 '원'이 붙은 숫자는 금액으로 인정.
 * - 맨숫자는 1000 이상이면서 '차/번/명/인/시/월/일/회' 같은 서수가
 *   뒤따르지 않을 때만 인정 (예: "1차"의 1은 제외).
 */
export function findAmounts(text: string): AmountMatch[] {
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(억|만|천)?\s*(원)?/g;
  const out: AmountMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim() === "") {
      re.lastIndex += 1;
      continue;
    }
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(num)) continue;
    const unit = m[2];
    const won = m[3];
    let value = num;
    if (unit === "억") value = num * 1e8;
    else if (unit === "만") value = num * 1e4;
    else if (unit === "천") value = num * 1e3;

    const hasUnit = Boolean(unit);
    const hasWon = Boolean(won);
    const after = text[m.index + m[0].length];
    const isOrdinalLike = after ? /[차번명인시월일회:：]/.test(after) : false;

    if (!hasUnit && !hasWon) {
      if (value < 1000) continue; // 맨숫자는 1000 이상만
      if (isOrdinalLike) continue; // "1차", "2번" 등 제외
    }

    out.push({ value: Math.round(value), index: m.index, length: m[0].length, raw: m[0].trim() });
  }
  return out;
}

/** 이름 정규화: 공백 제거 + 끝의 '님/씨' 호칭 제거 */
function normalizeName(name: string): string {
  return name.trim().replace(/[\s]/g, "").replace(/(님|씨)$/, "");
}

/** 쉼표/공백 등으로 구분된 이름 목록을 배열로 */
function splitNames(text: string): string[] {
  return text
    .split(NAME_SPLIT)
    .map((t) => normalizeName(t))
    .filter((t) => t.length > 0 && !PAYER_KEYWORD.test(t) && !PARTICIPANT_KEYWORD.test(t));
}

/**
 * "철수 10만, 영희 20만 결제" 같은 결제자 그룹을 파싱.
 * - 금액이 명시된 토큰은 그대로, 금액이 없는 토큰은 남은 금액을 균등 분배.
 * - 아무 금액도 없으면 total을 인원수로 균등 분배.
 */
function parsePayerGroup(group: string, total: number): Payer[] {
  const cleaned = group.replace(PAYER_KEYWORD, " ");
  const tokens = cleaned.split(/[,、&+]|및|그리고/).map((t) => t.trim()).filter(Boolean);

  const withAmount: Payer[] = [];
  const withoutAmount: string[] = [];

  for (const token of tokens) {
    const amounts = findAmounts(token);
    // 토큰에서 금액 텍스트를 제거하고 남은 걸 이름으로
    let nameText = token;
    for (const a of amounts) nameText = nameText.replace(a.raw, " ");
    const name = normalizeName(nameText);
    if (name.length === 0) continue;
    if (amounts.length > 0) {
      const sum = amounts.reduce((s, a) => s + a.value, 0);
      withAmount.push({ name, amount: sum });
    } else {
      withoutAmount.push(name);
    }
  }

  if (withoutAmount.length > 0) {
    const known = withAmount.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(total - known, 0);
    const base = Math.floor(remaining / withoutAmount.length);
    let rem = remaining - base * withoutAmount.length;
    for (const name of withoutAmount) {
      let share = base;
      if (rem > 0) {
        share += 1;
        rem -= 1;
      }
      withAmount.push({ name, amount: share });
    }
  }

  return withAmount;
}

/** 한 줄(또는 "/"로 연결된 한 항목)을 Expense로 파싱. 실패 시 null */
export function parseLine(line: string): Expense | null {
  const raw = line.trim();
  if (raw.length === 0) return null;
  // 주석/헤더 줄 무시
  if (/^[#*\-]{1,}\s*$/.test(raw)) return null;

  // 1) 괄호 그룹 추출 (한글/영문 괄호 모두)
  const parenGroups: string[] = [];
  const PLACEHOLDER = "\u0000";
  const withoutParens = raw.replace(/[([（]([^)\]）]*)[)\]）]/g, (_full, inner: string) => {
    parenGroups.push(inner.trim());
    return ` ${PLACEHOLDER} `;
  });

  // 2) 괄호 그룹 분류
  let payerGroup: string | null = null;
  let participantGroup: string | null = null;
  for (const g of parenGroups) {
    if (PAYER_KEYWORD.test(g)) {
      payerGroup = g;
    } else if (PARTICIPANT_KEYWORD.test(g)) {
      const after = g.replace(/.*?[:：]/, "");
      participantGroup = after.trim() || g;
    } else if (!participantGroup) {
      participantGroup = g; // 이름만 나열된 그룹 → 참여자
    }
  }

  // 3) 메인 금액 (괄호 밖 첫 유효 금액)
  const outerAmounts = findAmounts(withoutParens);
  const mainAmount = outerAmounts.length > 0 ? outerAmounts[0] : null;
  // 괄호 밖에 금액이 없고 결제자 그룹에만 금액이 있는 경우(드묾) 대비
  let total = mainAmount ? mainAmount.value : 0;

  // 4) 참여자: 괄호 밖 키워드 섹션이 최우선
  let participants: string[] = [];
  const kwMatch = withoutParens.match(
    /(?:참여자|참석자|참석|멤버|인원|명단)\s*[:：]?\s*([^\u0000]+)$/
  );
  if (kwMatch) {
    participants = splitNames(kwMatch[1]);
  } else if (participantGroup) {
    participants = splitNames(participantGroup);
  }

  // 5) 결제자
  let payers: Payer[] = [];
  if (payerGroup) {
    payers = parsePayerGroup(payerGroup, total);
    // 결제자 그룹에만 금액이 있고 메인 금액이 없으면 합계를 total로 사용
    if (!mainAmount && payers.length > 0) {
      total = payers.reduce((s, p) => s + p.amount, 0);
    }
  } else {
    // 괄호 밖 "이름결제" 패턴 → 단독 결제자(전액)
    const payerToken = withoutParens.match(
      /([가-힣A-Za-z][가-힣A-Za-z0-9]*?)\s*(?:결제|결재|계산|냄|쏨)/
    );
    if (payerToken) {
      payers = [{ name: normalizeName(payerToken[1]), amount: total }];
    }
  }

  // 참여자가 전혀 없으면 결제자를 참여자로 간주 (최소한의 폴백)
  if (participants.length === 0 && payers.length > 0) {
    participants = payers.map((p) => p.name);
  }

  // 6) 제목 추출
  let title = withoutParens;
  // 참여자 키워드 섹션 제거
  title = title.replace(/(?:참여자|참석자|참석|멤버|인원|명단)\s*[:：]?.*$/, "");
  // 메인 금액 텍스트 제거
  if (mainAmount) title = title.replace(mainAmount.raw, " ");
  // 결제자 토큰 제거
  title = title.replace(/([가-힣A-Za-z][가-힣A-Za-z0-9]*)\s*(?:결제|결재|계산|냄|쏨)/g, " ");
  // 플레이스홀더/구분자 제거
  title = title
    .replace(new RegExp(PLACEHOLDER, "g"), " ")
    .replace(/[/·|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length === 0) title = "지출";

  // 금액/결제자/참여자가 전혀 없으면 유효 항목이 아님
  if (total === 0 && payers.length === 0) return null;

  return { title, total, payers, participants };
}

/** 전체 메모 텍스트 → Expense[] */
export function parseMemo(text: string): Expense[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const expenses: Expense[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) expenses.push(parsed);
  }
  return expenses;
}
