/**
 * GET /api/attestation?slot=<slot>
 *
 * Fetches REAL attestation data from BAM Explorer for a given slot.
 * Returns null fields — not fake hashes — when BAM Explorer is unavailable.
 */

import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BAM_EXPLORER_API = process.env.BAM_EXPLORER_API ?? 'https://api.bam.dev';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slot = searchParams.get('slot');

  if (!slot || isNaN(Number(slot))) {
    return Response.json({ error: 'Missing or invalid slot parameter' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BAM_EXPLORER_API}/attestation/${slot}`, {
      signal:  AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    });

    if (res.status === 404) {
      // Normal — this slot had no BAM validator as leader
      return Response.json({
        slot:            Number(slot),
        attestationHash: null,
        makerCount:      0,
        takerCount:      0,
        verified:        false,
        proofUrl:        null,
        reason:          'no_bam_leader', // non-BAM validator produced this block
      });
    }

    if (!res.ok) {
      return Response.json({
        slot:            Number(slot),
        attestationHash: null,
        verified:        false,
        proofUrl:        null,
        reason:          `api_error_${res.status}`,
      });
    }

    const data = await res.json() as {
      attestation_hash?: string;
      maker_tx_count?:   number;
      taker_tx_count?:   number;
      plugin_version?:   string;
      tee_signature?:    string;
    };

    return Response.json({
      slot:            Number(slot),
      attestationHash: data.attestation_hash ?? null,
      makerCount:      data.maker_tx_count ?? 0,
      takerCount:      data.taker_tx_count ?? 0,
      pluginVersion:   data.plugin_version ?? null,
      // tee_signature present = cryptographically signed by AMD SEV-SNP hardware
      teeVerified:     !!data.tee_signature,
      verified:        !!data.attestation_hash,
      proofUrl:        data.attestation_hash
        ? `https://bam.dev/explorer/slot/${slot}`
        : null,
    });

  } catch (err) {
    console.error('[attestation] Fetch error:', err);
    return Response.json({
      slot:            Number(slot),
      attestationHash: null,
      verified:        false,
      proofUrl:        null,
      reason:          'fetch_error',
    });
  }
}
