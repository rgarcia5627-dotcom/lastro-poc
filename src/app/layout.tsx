import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Lastro", template: "%s · Lastro" },
  description: "Tokenização e gestão de ativos de crédito na rede Stellar.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
