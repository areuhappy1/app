# split-receipt 🧾

카톡이나 메모장에 **휘갈겨 쓴 정산 메모를 복붙**하면, 복잡한 분할 결제 내역을
계산해 **최소 송금 경로**와 **종이 영수증 스타일 카드**로 정리해주는 1/N 정산 웹앱.

- **Next.js 14 (App Router)** + **Tailwind CSS** + **TypeScript**
- 모든 계산은 100% 브라우저 안에서 순수 함수로 처리 (서버/AI 계산 없음)

## 실행 방법

```bash
cd split-receipt
npm install
npm run dev      # http://localhost:3000
```

프로덕션 빌드:

```bash
npm run build && npm run start
```

로직 스모크 테스트:

```bash
node --test src/lib/settlement.test.mjs
```

## 핵심 기능

1. **자유 형식 메모 입력** — 큰 Textarea + 원클릭 예시 버튼 2종(숙소 분할 / N차 모임)
2. **규칙·정규식 기반 파서** (`src/lib/parser.ts`)
   - 지출 항목명, 총금액(만/억/천/원·콤마 숫자 인식), 결제자(각자 낸 금액), 참여자 명단 추출
3. **정산 & 최소 송금 알고리즘** (`src/lib/settlement.ts`)
   - 개인별 결제액 → 부담액 → 순잔액 도출
   - 탐욕(Greedy) 알고리즘으로 송금 횟수 최소화 (`calculateMinTransfers`)
4. **종이 영수증 카드 UI** (`src/components/ReceiptCard.tsx`)
   - 크림색 배경, 상/하단 톱니 테두리, 점선 구분선, 모노스페이스
   - 총 지출액 · 참석 인원 · 1인당 평균 · 세부 내역 · 최소 송금 하이라이트
5. **액션 버튼**
   - 📷 영수증 이미지 저장(PNG) — `html-to-image`
   - 📋 카톡 텍스트 복사 — 단톡방에 바로 붙여넣는 정돈된 텍스트

## 입력 형식 예시

```
숙소비 30만원 (철수 10만, 영희 20만 결제) / 참여자: 철수, 영희, 민수, 지훈
```

```
1차 고깃집 12만 철수결제 (철수, 영희, 민수)
2차 볼링 4.5만 영희결제 (철수, 영희)
택시비 1.5만 민수결제 (철수, 민수)
```

- 괄호 안에 `결제`/금액이 있으면 **결제자 그룹**, 이름만 있으면 **참여자 그룹**으로 해석
- `참여자:` / `참석:` / `멤버:` 뒤의 목록도 참여자로 인식
- `이름결제` 패턴은 해당 인물이 전액 결제한 것으로 처리

## 구조

```
src/
├─ app/
│  ├─ layout.tsx        # 루트 레이아웃 / 메타데이터
│  ├─ page.tsx          # 입력 + 결과 화면 (클라이언트)
│  └─ globals.css       # Tailwind + 영수증 톱니/점선 스타일
├─ components/
│  └─ ReceiptCard.tsx   # 종이 영수증 카드 (PNG 캡처 대상)
└─ lib/
   ├─ types.ts          # 도메인 타입
   ├─ parser.ts         # 메모 → Expense[] 파서
   ├─ settlement.ts     # 정산 + 최소 송금 (순수 함수)
   ├─ format.ts         # 금액 포맷 / 카톡 텍스트 빌더
   ├─ examples.ts       # 원클릭 예시 데이터
   └─ settlement.test.mjs
```
