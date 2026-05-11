'use client';

import { useState } from 'react';
import type { AttestationRow } from '../../lib/types';

interface Props { rows: AttestationRow[] }

export function AttestationFeed({ rows }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopied(hash);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">TEE Attestation Feed</span>
        <div className="flex items-center gap-2">
          {rows.some(r => r.teeVerified) && <div className="live-dot" />}
          <span className="badge badge-violet text-[10px]">
            {rows.filter(r => r.teeVerified).length} verified
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
            <div className="text-[var(--muted)] text-xs">No attestations yet</div>
            <div className="text-[10px] text-[var(--faint)]">
              Enable MakerShield and execute fills to generate TEE proofs
            </div>
          </div>
        ) : (
          rows.map(row => (
            <AttestRow
              key={`${row.slot}-${row.attestationHash}`}
              row={row}
              copied={copied}
              onCopy={copy}
            />
          ))
        )}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--faint)]">
        Proofs signed by AMD SEV-SNP hardware inside BAM node
      </div>
    </div>
  );
}

function AttestRow({
  row, copied, onCopy,
}: {
  row: AttestationRow;
  copied: string | null;
  onCopy: (h: string) => void;
}) {
  const shortHash = (h: string) =>
    h.length >= 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;

  return (
    <div className="border-b border-[rgba(255,255,255,0.03)] px-3 py-2.5 hover:bg-[var(--bg-row)]">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="num text-[11px] text-[var(--muted)]">
            slot {row.slot.toLocaleString()}
          </span>
          {row.teeVerified ? (
            <span className="badge badge-violet text-[9px]">✓ AMD SEV-SNP</span>
          ) : (
            <span className="text-[9px] text-[var(--faint)]">no BAM leader</span>
          )}
        </div>
        <div className="flex gap-2 text-[10px] num">
          <span className="text-[var(--bid)]">{row.makerCount}M</span>
          <span className="text-[var(--ask)]">{row.takerCount}T</span>
        </div>
      </div>

      {row.attestationHash && (
        <div className="flex items-center gap-2">
          <code className="num text-[11px] text-[var(--violet)] flex-1 truncate">
            {shortHash(row.attestationHash)}
          </code>
          <button
            onClick={() => onCopy(row.attestationHash)}
            className="text-[10px] text-[var(--faint)] hover:text-[var(--muted)] px-1 shrink-0"
            title="Copy full hash"
          >
            {copied === row.attestationHash ? '✓' : '⎘'}
          </button>
          {row.teeVerified && (
            <a
              href={row.proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--violet)] hover:underline shrink-0"
            >
              BAM ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
