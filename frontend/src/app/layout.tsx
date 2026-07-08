import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatWidget } from "@/components/ChatWidget";
import { Providers } from "./providers";

// Inter as web-safe fallback for Graphik (loaded via CSS font stack)
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "KELIA Migration IA",
  description: "Application IA de Génération, Paramétrage et Recette Produit KELIA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={inter.variable} style={{ fontFamily: '"Graphik", var(--font-inter), "Helvetica Neue", Arial, sans-serif' }}>
        <Providers>
          <div className="flex">
            <Sidebar />
            <main className="flex-1 ml-64 min-h-screen bg-white">
              <div className="p-8">{children}</div>
            </main>
            <ChatWidget />
          </div>
        </Providers>
      </body>
    </html>
  );
}
