import './globals.css';
import { BrandFavicon } from './brand';
import { Toaster } from './toast';
import { Inter, Noto_Sans_Thai } from 'next/font/google';

// Self-hosted at build time: browsers never request Google. Inter for Latin, Noto Sans Thai for Thai.
const inter = Inter({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const thai = Noto_Sans_Thai({ subsets: ['thai'], weight: ['400', '500', '600', '700'], variable: '--font-thai', display: 'swap' });

export const metadata = { title: 'KooChang คู่ช่าง', description: 'Shop workspace and platform administration', icons: { apple: '/apple-touch-icon.png' } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th" className={`${inter.variable} ${thai.variable}`}><body><BrandFavicon />{children}<Toaster /></body></html>;
}
