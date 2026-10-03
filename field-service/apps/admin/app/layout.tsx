import './globals.css';
export const metadata = { title: 'Field Service Foundation', description: 'Platform development foundation' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
