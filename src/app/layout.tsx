import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WB AI Public Support System — Grievance Portal",
  description:
    "West Bengal AI Public Support System — Government grievance management dashboard. Monitor and manage citizen complaints across all blocks and districts.",
  keywords: [
    "West Bengal", "GovTech", "Grievance Portal", "Complaints", "Dashboard", "Government", "AI Support",
  ],
  authors: [{ name: "District Administration, West Bengal" }],
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{`
          @media print {
            header, footer, nav, .print\\:hidden, [class*="print:hidden"] { display: none !important; }
            main { padding: 0 !important; max-width: 100% !important; }
            .print\\:space-y-4 > * { margin-bottom: 1rem; page-break-inside: avoid; }
            body { background: white !important; }
            * { color-adjust: exact; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        `}</style>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
