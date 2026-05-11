'use client';

import { useEffect, useRef } from 'react';
import type { Candle, Trade } from '../../lib/types';

interface Props {
  candles: Candle[];
  recentTrades: Trade[];
  symbol?: string;
}

export function CandleChart({ candles, recentTrades, symbol = 'SOL/USDC' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const seriesRef = useRef<unknown>(null);
  const volumeRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;

    // Dynamically import lightweight-charts (client only)
    import('lightweight-charts').then(({ createChart, ColorType, CrosshairMode }) => {
      if (!containerRef.current) return;

      // Destroy old chart
      if (chartRef.current) {
        (chartRef.current as { remove: () => void }).remove();
      }

      const chart = createChart(containerRef.current!, {
        layout: {
          background: { type: ColorType.Solid, color: '#0D1117' },
          textColor: '#64748B',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.04)' },
          horzLines: { color: 'rgba(255,255,255,0.04)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1E293B' },
          horzLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1E293B' },
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.07)',
          textColor: '#64748B',
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.07)',
          timeVisible: true,
          secondsVisible: false,
        },
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor:          '#22C55E',
        downColor:        '#EF4444',
        borderUpColor:    '#22C55E',
        borderDownColor:  '#EF4444',
        wickUpColor:      '#22C55E',
        wickDownColor:    '#EF4444',
      });

      const volSeries = chart.addHistogramSeries({
        color: 'rgba(139,92,246,0.3)',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      chartRef.current  = chart;
      seriesRef.current = candleSeries;
      volumeRef.current = volSeries;

      if (candles.length > 0) {
        candleSeries.setData(candles as unknown as Parameters<typeof candleSeries.setData>[0]);
        volSeries.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' })) as unknown as Parameters<typeof volSeries.setData>[0]);
        chart.timeScale().fitContent();
      }

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      });
      ro.observe(containerRef.current!);

      return () => { ro.disconnect(); };
    });

    return () => {
      if (chartRef.current) {
        (chartRef.current as { remove: () => void }).remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Update candle data without recreating chart
  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || candles.length === 0) return;
    const cs = seriesRef.current as { setData: (d: unknown) => void };
    const vs = volumeRef.current as { setData: (d: unknown) => void };
    cs.setData(candles as unknown);
    vs.setData(candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
    })) as unknown);
  }, [candles]);

  const lastCandle = candles.at(-1);
  const prevCandle = candles.at(-2);
  const priceChange = lastCandle && prevCandle
    ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
    : null;
  const isUp = priceChange !== null && priceChange >= 0;

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <span className="panel-title">{symbol}</span>
          {lastCandle && (
            <>
              <span className="num font-semibold text-sm text-[var(--tx)]">
                ${lastCandle.close.toFixed(3)}
              </span>
              {priceChange !== null && (
                <span className={`num text-xs ${isUp ? 'text-[var(--bid)]' : 'text-[var(--ask)]'}`}>
                  {isUp ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastCandle && (
            <span className="text-[10px] text-[var(--muted)] num">
              V: {lastCandle.volume.toFixed(2)} SOL
            </span>
          )}
          <span className="text-[10px] text-[var(--muted)]">1m</span>
        </div>
      </div>
      {candles.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
          No trade data yet — place and fill orders to see candles
        </div>
      ) : (
        <div ref={containerRef} className="flex-1" />
      )}
    </div>
  );
}
