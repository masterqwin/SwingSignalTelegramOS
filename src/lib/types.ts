export type SignalStatus = "SETUP" | "ENTRY_HIT" | "TARGET1_HIT" | "TARGET2_HIT" | "CANCELLED" | "CLOSED" | "HOLD" | "NO_MORE_DCA";

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
  recoveryEntryPrice: number;
  previousEntryPrice: number;
  previousPositionUsdt: number;
  newStakeUsdt: number;
  newStakeThb: number;
  averageEntryPrice: number;
  totalPositionUsdt: number;
  totalPositionThb: number;
  updatedTarget1: number;
  updatedTarget2: number;
  score: number;
}
