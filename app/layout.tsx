import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ca Làm — Sổ lương của bạn",
  description: "Ghi ca làm theo vị trí, tính lương và đối chiếu thu nhập hàng tháng.",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
