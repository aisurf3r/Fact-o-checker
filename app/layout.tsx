import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Fact·O·Checker — Autonomous OSINT Verification Agent",
  description:
    "Paste any news headline, claim, or URL and get an AI-powered fact-check verdict in seconds. Powered by Llama-3.3-70b, Tavily Search, VirusTotal, and RDAP.",
  keywords: [
    "fact checker",
    "fake news detector",
    "OSINT",
    "misinformation",
    "AI fact check",
    "news verification",
    "URL reputation",
    "domain check",
  ],
  authors: [{ name: "aisurf3r", url: "https://github.com/aisurf3r" }],
  creator: "aisurf3r",
  metadataBase: new URL("https://fact-o-checker.vercel.app"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://fact-o-checker.vercel.app",
    siteName: "Fact·O·Checker",
    title: "Fact·O·Checker — Autonomous OSINT Verification Agent",
    description:
      "Paste any news headline, claim, or URL and get an AI-powered fact-check verdict in seconds.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fact·O·Checker — Autonomous OSINT Verification Agent",
    description:
      "Paste any news headline, claim, or URL and get an AI-powered fact-check verdict in seconds.",
    creator: "@aisurf3r",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
  icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
