import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Fact·o·Checker — OSINT Verification Agent",
  description: "Autonomous OSINT agent that verifies news claims and URLs in real time.",
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
