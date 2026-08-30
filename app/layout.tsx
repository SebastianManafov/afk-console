import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Remote Console Client (RCC)',
  description: 'Sicherer, proxy-erzwungener Minecraft AFK-Client mit Web-Konsole.',
  openGraph: {
    title: 'Remote Console Client (RCC)',
    description: 'Deine Welt bleibt online — mit erzwungenem SOCKS5-Proxy.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Remote Console Client (RCC)',
    description: 'Deine Welt bleibt online — mit erzwungenem SOCKS5-Proxy.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
