import type { Metadata } from "next";
import "./globals.css";
import { AppTheme } from "@/components/theme-controls";

export const metadata: Metadata = {
  title: "ShiftTrack — Theo dõi giờ làm và kỳ lương",
  description: "Theo dõi giờ làm, tính lương và kiểm tra kỳ lương của bạn.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="antialiased"><AppTheme>{children}</AppTheme></body>
    </html>
  );
}
