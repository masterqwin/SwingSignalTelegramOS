export type SignalStatus =
  | "SETUP"
  | "ENTRY_HIT"
  | "PRE_TARGET_1_MANAGEMENT"
  | "TARGET1_HIT"
  | "PROFIT_PROTECTION"
  | "TARGET2_HIT"
  | "ENTRY_RETRACE_CLOSED"
  | "TP2_TIMEOUT_CLOSED"
  | "PRE_TP1_REVIEW_REQUIRED"
  | "CANCELLED"
  | "CLOSED"
  | "HOLD"
  | "NO_MORE_DCA";

export type CloseReason = "FULL_TARGET_CLOSED" | "ENTRY_RETRACE_CLOSED" | "TP2_TIMEOUT_CLOSED" | "CANCELLED" | null;

export interface SystemConfig {
  usdthbRate: number;
  scanIntervalMinutes: number;
  signalExpiryDays: number;
  startingCapitalThb: number;
  defaultStakeThb: number;
  maxActiveSignals: number;
  minQuoteVolumeUsdt: number;
  debugSignal: boolean;
  maxDcaEntries: number;
  recoveryDropPct: number;
  recoveryScoreThreshold: number;
  tradingFeePct: number;
  slippageBufferPct: number;
  minNetProfitTp1Pct: number;
  minNetProfitTp2Pct: number;
  positionPlanDays: number;
  tp2GraceDays: number;
  entryRetraceBufferPct: number;
}

export interface SignalRow {
  id: number;
  signal_id: string;
  pair: string;
  symbol: string;
  status: SignalStatus;
  created_at: string;
  expires_at: string;
  entry_low: number;
  entry_high: number;
  current_price_at_signal: number;
  target1: number;
  target2: number;
  stake_thb: number;
  usdthb_rate: number;
  score: number;
  confidence_pct: number;
  quality_label: string;
  position_reason_th: string | null;
  market_guard_status: string | null;
  market_guard_reason: string | null;
  risk_level: string;
  reason_th: string;
  entry_hit_at: string | null;
  target1_hit_at: string | null;
  target2_hit_at: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  max_drawdown_pct: number;
  max_profit_pct: number;
  is_debug: number;
  parent_signal_id: string | null;
  dca_level: number;
  average_entry_price: number | null;
  total_position_usdt: number | null;
  total_position_thb: number | null;
  updated_target1: number | null;
  updated_target2: number | null;
  lifecycle_status: SignalStatus | null;
  close_reason: CloseReason;
  position_plan_started_at: string | null;
  position_plan_expires_at: string | null;
  tp2_grace_expires_at: string | null;
  profit_protection_started_at: string | null;
  break_even_price: number | null;
  total_quantity: number | null;
  remaining_quantity: number | null;
  target_version: number;
  realized_gross_profit_usdt: number | null;
  realized_fees_usdt: number | null;
  realized_net_profit_usdt: number | null;
  realized_net_profit_thb: number | null;
  unrealized_remaining_pnl_usdt: number | null;
  final_net_profit_usdt: number | null;
  final_net_profit_thb: number | null;
}

export interface SignalEventRow {
  id: number;
  signal_id: string;
  event_type: string;
  message_th: string;
  created_at: string;
}

export interface GateTicker {
  currency_pair: string;
  last: string;
  quote_volume: string;
  change_percentage: string;
  high_24h: string;
  low_24h: string;
}

export interface Candle {
  timestamp: number;
  volume: number;
  close: number;
  high: number;
  low: number;
  open: number;
}

export interface SignalCandidate {
  pair: string;
  symbol: string;
  entryLow: number;
  entryHigh: number;
  currentPrice: number;
  target1: number;
  target2: number;
  score: number;
  confidencePct: number;
  qualityLabel: string;
  recommendedStakeThb: number;
  positionReasonTh: string;
  marketGuardStatus: MarketGuardStatus;
  marketGuardReason: string;
  riskLevel: string;
  reasonTh: string;
}

export type MarketGuardStatus = "normal" | "caution" | "risk_off";

export interface MarketGuardResult {
  status: MarketGuardStatus;
  labelTh: string;
  reason: string;
  confidenceAdjustment: number;
  blockNewSetups: boolean;
}

export interface PortfolioHeat {
  startingCapitalThb: number;
  activeExposureThb: number;
  reserveThb: number;
  reservePct: number;
  recoveryExposureThb: number;
  activeSetupCount: number;
  activeCoinCount: number;
  maxActiveSignals: number;
  heatPct: number;
}

export interface RecoveryPlan {
  parentSignalId: string;
  dcaLevel: number;
  recoveryEntryLow: number;
  recoveryEntryHigh: number;
  recoveryEntryPrice: number;
  previousEntryPrice: number;
  previousPositionUsdt: number;
  newStakeUsdt: number;
  newStakeThb: number;
  newQuantity: number;
  newFeeUsdt: number;
  totalQuantity: number;
  totalCostUsdt: number;
  averageEntryPrice: number;
  breakEvenPrice: number;
  totalPositionUsdt: number;
  totalPositionThb: number;
  updatedTarget1: number;
  updatedTarget2: number;
  expectedNetTp1Usdt: number;
  expectedNetFullUsdt: number;
  targetVersion: number;
  score: number;
}

export interface PositionEntryRow {
  id: number;
  signal_id: string;
  dca_level: number;
  entry_low: number;
  entry_high: number;
  filled_price: number | null;
  stake_usdt: number;
  stake_thb: number;
  quantity: number;
  fee_usdt: number;
  entry_hit_at: string | null;
  created_at: string;
}

export interface TargetPlanHistoryRow {
  id: number;
  signal_id: string;
  target_version: number;
  average_entry: number;
  break_even: number;
  target1: number;
  target2: number;
  expected_net_tp1: number;
  expected_net_full: number;
  created_at: string;
  replaced_at: string | null;
}
