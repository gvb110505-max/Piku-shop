import { createContext, useContext } from 'react';

export interface AppConfig {
  coin: { name: string; ticker: string; algorithm: string; blockTimeSec: number };
  quote: string; testMode: boolean;
  coinStatus: 'PRE_LISTING' | 'CALL_AUCTION' | 'LISTED'; auctionEndAt: string | null;
  markets: { spot: string; perp: string };
  stratum: { host: string; port: number };
  perp: { maxLeverage: number; mmrBps: number; liqFeeBps: number; fundingIntervalHours: number };
  miningFutures: { buyerMarginBps: number; sellerMarginBps: number; sellLimitFactorBps: number };
  pool: { feeBps: number; maturity: number };
  wallet: { withdrawFee: string; withdrawMin: string; depositConfirmations: number };
}

export const ConfigContext = createContext<AppConfig | null>(null);
export const useConfig = () => useContext(ConfigContext)!;
