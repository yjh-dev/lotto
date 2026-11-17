/**
 * 복권 당첨금 실수령액 (기타소득세 + 지방소득세)
 *   200만 원 이하: 비과세
 *   200만 원 초과: (당첨금 − 구입비 1,000원) 중 3억 원까지 22%, 3억 원 초과분 33%
 * 세법이 바뀔 수 있으므로 참고값
 */
export function prizeTax(amount: number, ticketCost = 1000): number {
  if (amount <= 2_000_000) return 0;
  const base = amount - ticketCost;
  return Math.round(Math.min(base, 3e8) * 0.22 + Math.max(0, base - 3e8) * 0.33);
}

export const netPrize = (amount: number) => amount - prizeTax(amount);
