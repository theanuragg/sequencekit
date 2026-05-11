import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SequenceKit — First Open-Source Jito BAM Plugin',
  description: 'MakerShield: cancel-before-fill ordering for any Solana DEX. Built at Jito Hackathon 2025.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
