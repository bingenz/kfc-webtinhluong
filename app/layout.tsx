import type { Metadata } from "next";
import "./globals.css";
import { AppTheme } from "@/components/theme-controls";

export const metadata: Metadata = {
  title: "Ca Làm — Sổ lương của bạn",
  description: "Ghi ca làm theo vị trí, tính lương và đối chiếu thu nhập hàng tháng.",
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
