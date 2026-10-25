import type { Metadata } from 'next';
import { Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google';
import './globals.css';
import { schoolConfig } from '@/school.config';

const sans = Noto_Sans_TC({
  variable: '--font-sans-tc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '900'],
});

const serif = Noto_Serif_TC({
  variable: '--font-serif-tc',
  subsets: ['latin'],
  weight: ['600', '700', '900'],
});

export const metadata: Metadata = {
  title: `句子翻譯測驗｜${schoolConfig.schoolName}`,
  description: '句子翻譯測驗的教師出題、發布與評分工作區。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
