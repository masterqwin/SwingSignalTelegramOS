import type { SignalRow } from "./types";

export const PNL_EPSILON_USDT = 0.01;
export type ClosedSignalResult = "WIN" | "LOSS" | "BREAKEVEN" | "UNKNOWN";

type ResultSignal = Pick<SignalRow, "status" | "closed_at" | "close_reason" | "final_net_profit_usdt" | "realized_net_profit_usdt">;

export function isClosedSignal(signal: ResultSignal) {
  return Boolean(signal.closed_at)
    || signal.status === "CLOSED"
    || signal.status === "CANCELLED"
    || signal.status === "ENTRY_RETRACE_CLOSED"
    || signal.status === "TP2_TIMEOUT_CLOSED"
    || signal.close_reason === "FULL_TARGET_CLOSED"
    || signal.close_reason === "CANCELLED"
    || signal.close_reason === "ENTRY_RETRACE_CLOSED"
    || signal.close_reason === "TP2_TIMEOUT_CLOSED";
}

export function getClosedSignalPnlUsdt(signal: ResultSignal) {
  if (!isClosedSignal(signal)) return null;
  if (signal.final_net_profit_usdt !== null && signal.final_net_profit_usdt !== undefined) return signal.final_net_profit_usdt;
  if (signal.realized_net_profit_usdt !== null && signal.realized_net_profit_usdt !== undefined && hasFinalRealizedPnl(signal)) {
    return signal.realized_net_profit_usdt;
  }
  return null;
}

export function classifyClosedSignalResult(signal: ResultSignal): ClosedSignalResult | null {
  if (!isClosedSignal(signal)) return null;
  const pnl = getClosedSignalPnlUsdt(signal);
  if (pnl === null || pnl === undefined || !Number.isFinite(pnl)) return "UNKNOWN";
  if (pnl > PNL_EPSILON_USDT) return "WIN";
  if (pnl < -PNL_EPSILON_USDT) return "LOSS";
  return "BREAKEVEN";
}

export function summarizeClosedSignalResults(signals: ResultSignal[]) {
  let closedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let unknownResultCount = 0;
  let paperNetPnlUsdt = 0;

  for (const signal of signals) {
    const result = classifyClosedSignalResult(signal);
    if (!result) continue;
    closedCount += 1;
    const pnl = getClosedSignalPnlUsdt(signal);
    if (pnl !== null && pnl !== undefined && Number.isFinite(pnl)) paperNetPnlUsdt += pnl;
    if (result === "WIN") winCount += 1;
    if (result === "LOSS") lossCount += 1;
    if (result === "BREAKEVEN") breakevenCount += 1;
    if (result === "UNKNOWN") unknownResultCount += 1;
  }

  const winRateDenominator = winCount + lossCount + breakevenCount;
  const decisiveDenominator = winCount + lossCount;
  return {
    closedCount,
    winCount,
    lossCount,
    breakevenCount,
    unknownResultCount,
    winRateDenominator,
    winRate: pct(winCount, winRateDenominator),
    decisiveWinRate: pct(winCount, decisiveDenominator),
    paperNetPnlUsdt
  };
}

function hasFinalRealizedPnl(signal: ResultSignal) {
  return signal.close_reason === "FULL_TARGET_CLOSED"
    || signal.close_reason === "ENTRY_RETRACE_CLOSED"
    || signal.close_reason === "TP2_TIMEOUT_CLOSED"
    || signal.status === "CLOSED"
    || signal.status === "ENTRY_RETRACE_CLOSED"
    || signal.status === "TP2_TIMEOUT_CLOSED";
}

function pct(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}
