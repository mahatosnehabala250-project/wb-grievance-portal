import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";

// Geist has no Bengali glyphs, so every complaint written in Bengali fell back
// to whatever the device had. Plex carries the Latin UI; Noto Sans Bengali is
// second in the stack and picks up every Bengali character.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "বাংলার সহায়ক — Citizen Grievance Portal",
  description:
    "Banglar Sahayak — AI-powered citizen grievance management and constituency service platform for West Bengal. Built by NeuroSetu AI.",
  keywords: [
    "West Bengal", "CivicTech", "Grievance Portal", "Complaints", "Dashboard", "AI Support",
  ],
  authors: [{ name: "Banglar Sahayak" }],
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
      <body className={`${plexSans.variable} ${plexMono.variable} ${notoBengali.variable} antialiased bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
