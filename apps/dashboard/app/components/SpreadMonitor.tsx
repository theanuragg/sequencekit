'use client';

import {
  Area, AreaChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SpreadDataPoint } from '../../lib/types';

interface Props { data: SpreadDataPoint[]; pluginActive: boolean }

const MAX = 100;

export function SpreadMonitor({ data, pluginActive }: Props) {
  const display = data.slice(-MAX);
  const onPts  = display.filter(d => d.pluginActive);
  const offPts = display.filter(d => !d.pluginActive);
  const avgOn  = onPts.length  ? onPts.reduce((s, d)  => s + d.bps, 0) / onPts.length  : null;
  const avgOff = offPts.length ? offPts.reduce((s, d) => s + d.bps, 0) / offPts.length : null;
  const pct = avgOn !== null && avgOff !== null && avgOff > 0
    ? Math.round(((avgOff - avgOn) / avgOff) * 100) : null;
  const latest = display.at(-1);
  const chartData = display.map(d => ({ slot: d.slot, on: d.pluginActive ? d.bps : undefined, off: !d.pluginActive ? d.bps : undefined }));

  return (
    <div className="panel flex flex-col">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <span className="panel-title">Spread Monitor</span>
          <span className={`badge text-[10px] ${pluginActive ? 'badge-amber' : 'badge-sky'}`}>
            {pluginActive ? '🛡 Plugin ON' : '○ Plugin OFF'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {latest && <span className="num text-sm font-semibold" style={{ color: pluginActive ? 'var(--bid)' : 'var(--ask)' }}>{latest.bps.toFixed(1)} bps</span>}
          {pct !== null && <span className="badge badge-violet text-[10px]">−{pct}% vs baseline</span>}
        </div>
      </div>
      <div className="h-36 px-2 py-2">
        {display.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-xs">Waiting for SpreadChanged events…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gOn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOff" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="slot" hide />
              <YAxis tick={{ fill: '#64748B', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}bp`} domain={[0,'auto']} width={30} />
              <Tooltip contentStyle={{ background: '#0D1117', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: '#64748B' }} formatter={(v: number, name: string) => [`${v.toFixed(1)} bps`, name === 'on' ? 'Plugin ON' : 'Plugin OFF']} />
              <Area type="monotone" dataKey="on"  stroke="#22C55E" fill="url(#gOn)"  strokeWidth={1.5} dot={false} connectNulls={false} />
              <Area type="monotone" dataKey="off" stroke="#EF4444" fill="url(#gOff)" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {(avgOn !== null || avgOff !== null) && (
        <div className="flex gap-4 px-3 pb-2 text-[10px] num text-[var(--muted)]">
          {avgOn  !== null && <span className="text-[var(--bid)]">avg ON: {avgOn.toFixed(1)}bp</span>}
          {avgOff !== null && <span className="text-[var(--ask)]">avg OFF: {avgOff.toFixed(1)}bp</span>}
        </div>
      )}
    </div>
  );
}
