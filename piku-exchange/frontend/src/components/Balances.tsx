import { fmt } from '../format';
import { useApi } from '../hooks';

export interface BalanceRow { asset: string; available: string; locked: string; immatureMining?: string; deliveryObligation?: string; virtual?: boolean }

export function useBalances() {
  return useApi<BalanceRow[]>('/api/balances', ['user']);
}

export function BalanceLine({ balances, asset }: { balances: BalanceRow[] | null; asset: string }) {
  const b = balances?.find((x) => x.asset === asset);
  return (
    <div className="flex justify-between text-xs text-muted">
      <span>주문 가능 {asset}{b?.virtual ? ' (가상)' : ''}</span>
      <span className="font-mono text-gray-200">{fmt(b?.available ?? '0', 8)}</span>
    </div>
  );
}
