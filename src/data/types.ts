/** 정규화된 로또 6/45 회차 데이터 (앱 전체에서 사용하는 형식) */
export interface Draw {
  /** 회차 */
  round: number;
  /** 추첨일 YYYY-MM-DD */
  date: string;
  /** 당첨번호 6개 (오름차순) */
  numbers: [number, number, number, number, number, number];
  /** 보너스 번호 */
  bonus: number;
  /** 등수별 당첨 정보: index 0 = 1등 ... 4 = 5등 */
  prizes: Prize[];
  /** 총 판매액 (원) — API wholEpsdSumNtslAmt */
  totalSales: number;
  /** 당첨금 재원 (원) — API rlvtEpsdSumNtslAmt, 판매액의 약 50% */
  prizePool: number;
  /** 1등 당첨 방식별 인원 (API winType0~3) */
  firstWinType: {
    /** winType0 — 의미 미확인 */
    unknown: number;
    auto: number;
    manual: number;
    semiAuto: number;
  };
}

export interface Prize {
  rank: 1 | 2 | 3 | 4 | 5;
  /** 당첨자 수 */
  winners: number;
  /** 1인당 당첨금 (원) */
  amount: number;
}

/** 동행복권 /lt645/selectPstLt645InfoNew.do 응답의 list 원소 */
export interface RawDraw {
  ltEpsd: number;
  ltRflYmd: string;
  tm1WnNo: number;
  tm2WnNo: number;
  tm3WnNo: number;
  tm4WnNo: number;
  tm5WnNo: number;
  tm6WnNo: number;
  bnsWnNo: number;
  rnk1WnNope: number;
  rnk1WnAmt: number;
  rnk2WnNope: number;
  rnk2WnAmt: number;
  rnk3WnNope: number;
  rnk3WnAmt: number;
  rnk4WnNope: number;
  rnk4WnAmt: number;
  rnk5WnNope: number;
  rnk5WnAmt: number;
  rlvtEpsdSumNtslAmt: number;
  wholEpsdSumNtslAmt: number;
  winType0: number;
  winType1: number;
  winType2: number;
  winType3: number;
  [key: string]: unknown;
}
