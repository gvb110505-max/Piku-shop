import { CandlestickSeries, createChart, HistogramSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { api, socket } from '../api';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

interface Candle { time: number; open: string; high: string; low: string; close: string; volume: string }

/** 캔들차트 (1분~1일). 새 체결이 오면 다시 불러온다. */
export function CandleChart({ marketId }: { marketId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [interval, setIntervalState] = useState<(typeof INTERVALS)[number]>('1m');

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 320, layout: { background: { color: '#121722' }, textColor: '#8a94a6' },
      grid: { vertLines: { color: '#1f2633' }, horzLines: { color: '#1f2633' } },
      timeScale: { timeVisible: true, secondsVisible: false }, rightPriceScale: { borderColor: '#1f2633' },
    });
    chartRef.current = chart;
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#16c784', downColor: '#ea3943', borderVisible: false, wickUpColor: '#16c784', wickDownColor: '#ea3943' });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', color: '#2a3344' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const load = async () => {
      const data = await api<Candle[]>(`/api/markets/${marketId}/candles?interval=${interval}`).catch(() => []);
      candles.setData(data.map((c) => ({ time: c.time as UTCTimestamp, open: +c.open, high: +c.high, low: +c.low, close: +c.close })));
      volume.setData(data.map((c) => ({ time: c.time as UTCTimestamp, value: +c.volume, color: +c.close >= +c.open ? '#16c78455' : '#ea394355' })));
    };
    load();
    const off = socket.on(`trades:${marketId}`, load);
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);
    return () => { off(); ro.disconnect(); chart.remove(); };
  }, [marketId, interval]);

  return (
    <div className="panel">
      <div className="panel-title">
        <span>차트</span>
        <div className="flex gap-1">
          {INTERVALS.map((i) => (
            <button key={i} className={`tab text-xs ${i === interval ? 'tab-active' : ''}`} onClick={() => setIntervalState(i)}>{i}</button>
          ))}
        </div>
      </div>
      <div ref={ref} className="w-full" />
    </div>
  );
}
