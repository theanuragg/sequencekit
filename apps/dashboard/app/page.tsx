// Server Component — reads env vars server-side
import { SolanaWalletProvider } from './components/WalletProvider';
import { DashboardClient }      from './components/DashboardClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ cluster?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const params  = await searchParams;
  const cluster = params.cluster ?? 'devnet';
  const rpcUrl  = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';

  return (
    <SolanaWalletProvider rpcUrl={rpcUrl}>
      <DashboardClient
        rpcUrl={rpcUrl}
        programId={process.env.NEXT_PUBLIC_PROGRAM_ID ?? '93bKGD7STjvA2h4if8cs4sVxJqtUmxmh8tYFBaRhEgsn'}
        marketAddress={process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? ''}
        cluster={cluster}
      />
    </SolanaWalletProvider>
  );
}
