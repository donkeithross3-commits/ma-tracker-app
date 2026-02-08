import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/providers/SessionProvider";
import { UIPreferencesProvider } from "@/lib/ui-preferences";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "M&A Deal Tracker",
  description: "Track merger arbitrage deals and portfolio positions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SessionProvider>
          <UIPreferencesProvider>
            {children}
          </UIPreferencesProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
