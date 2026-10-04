import './globals.css';
export const metadata = { title: 'Field Service', description: 'Shop workspace and platform administration' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
