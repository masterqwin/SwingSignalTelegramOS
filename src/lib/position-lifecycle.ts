import type { PositionEntryRow, SignalRow, SystemConfig, TargetPlanHistoryRow } from "./types";

export interface PositionEntryInput {
  dcaLevel: number;
  entryLow: number;
  entryHigh: number;
  filledPrice: number;
  stakeThb: number;
  usdthbRate: number;
  createdAt: string;
}

export interface PositionPlan {
  averageEntry: number;
  breakEven: number;
  target1: number;
  target2: number;
  totalQuantity: number;
  totalCostUsdt: number;
  totalStakeThb: number;
  expectedNetTp1: number;
  expectedNetFull: number;
}

export interface RealizedLeg {
  grossProfitUsdt: number;
  feesUsdt: number;
  netProfitUsdt: number;
}

export function buildPositionEntry(input: PositionEntryInput, config: SystemConfig): Omit<PositionEntryRow, "id" | "signal_id"> {
  const stakeUsdt = input.stakeThb / input.usdthbRate;
  const quantity = stakeUsdt / input.filledPrice;
  const feeUsdt = stakeUsdt * pct(config.tradingFeePct);
  return {
    dca_level: input.dcaLevel,
    entry_low: input.entryLow,
    entry_high: input.entryHigh,
    filled_price: input.filledPrice,
    stake_usdt: stakeUsdt,
    stake_thb: input.stakeThb,
    quantity,
    fee_usdt: feeUsdt,
    entry_hit_at: input.createdAt,
    created_at: input.createdAt
  };
}

export function calculatePositionPlan(entries: Array<Pick<PositionEntryRow, "filled_price" | "stake_usdt" | "stake_thb" | "quantity" | "fee_usdt">>, config: SystemConfig): PositionPlan | null {
  const filled = entries.filter((entry) => entry.filled_price && entry.filled_price > 0 && entry.quantity > 0);
  const totalQuantity = filled.reduce((sum, entry) => sum + entry.quantity, 0);
  if (totalQuantity <= 0) return null;

  const totalStakeUsdt = filled.reduce((sum, entry) => sum + entry.stake_usdt, 0);
  const totalStakeThb = filled.reduce((sum, entry) => sum + entry.stake_thb, 0);
  const entryFees = filled.reduce((sum, entry) => sum + entry.fee_usdt, 0);
  const weightedEntry = filled.reduce((sum, entry) => sum + (entry.filled_price || 0) * entry.quantity, 0) / totalQuantity;
  const exitCostPct = pct(config.tradingFeePct + config.slippageBufferPct);
  const breakEven = (totalStakeUsdt + entryFees) / Math.max(totalQuantity * (1 - exitCostPct), 0.00000001);
  const target1 = roundPrice(Math.max(weightedEntry * 1.045, breakEven * (1 + pct(config.minNetProfitTp1Pct))));
  const target2 = roundPrice(Math.max(weightedEntry * 1.082, target1 * 1.01, breakEven * (1 + pct(config.minNetProfitTp2Pct))));
  if (target1 > weightedEntry * 1.3 || target2 > weightedEntry * 1.5) return null;
  const expectedNetTp1 = calculateExitLeg(filled, target1, 0.5, config).netProfitUsdt;
  const expectedNetFull = expectedNetTp1 + calculateExitLeg(filled, target2, 0.5, config).netProfitUsdt;

  if (expectedNetTp1 <= 0 || expectedNetFull <= expectedNetTp1) return null;

  return {
    averageEntry: roundPrice(weightedEntry),
    breakEven: roundPrice(breakEven),
    target1,
    target2,
    totalQuantity,
    totalCostUsdt: totalStakeUsdt + entryFees,
    totalStakeThb,
    expectedNetTp1,
    expectedNetFull
  };
}

export function calculateExitLeg(
  entries: Array<Pick<PositionEntryRow, "stake_usdt" | "quantity" | "fee_usdt">>,
  exitPrice: number,
  fraction: number,
  config: SystemConfig
): RealizedLeg {
  const totalQuantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalStakeUsdt = entries.reduce((sum, entry) => sum + entry.stake_usdt, 0);
  const entryFees = entries.reduce((sum, entry) => sum + entry.fee_usdt, 0);
  const quantity = totalQuantity * fraction;
  const proceeds = quantity * exitPrice;
  const sellFee = proceeds * pct(config.tradingFeePct);
  const slippage = proceeds * pct(config.slippageBufferPct);
  const proportionalCost = (totalStakeUsdt + entryFees) * fraction;
  const grossProfitUsdt = proceeds - totalStakeUsdt * fraction;
  const netProfitUsdt = proceeds - sellFee - slippage - proportionalCost;
  return {
    grossProfitUsdt,
    feesUsdt: entryFees * fraction + sellFee + slippage,
    netProfitUsdt
  };
}

export function calculateRemainingClose(signal: SignalRow, entries: PositionEntryRow[], currentPrice: number, config: SystemConfig) {
  const remainingFraction = signal.remaining_quantity && signal.total_quantity ? signal.remaining_quantity / signal.total_quantity : 0.5;
  return calculateExitLeg(entries, currentPrice, remainingFraction, config);
}

export function makeTargetPlanRow(signal: SignalRow, plan: PositionPlan, targetVersion: number, now: string): Omit<TargetPlanHistoryRow, "id" | "signal_id" | "replaced_at"> {
  return {
    target_version: targetVersion,
    average_entry: plan.averageEntry,
    break_even: plan.breakEven,
    target1: plan.target1,
    target2: plan.target2,
    expected_net_tp1: plan.expectedNetTp1,
    expected_net_full: plan.expectedNetFull,
    created_at: now
  };
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function roundPrice(value: number) {
  if (value >= 100) return Number(value.toFixed(2));
  if (value >= 1) return Number(value.toFixed(4));
  return Number(value.toFixed(6));
}

function pct(value: number) {
  return value / 100;
}
