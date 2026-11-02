import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Morrow — Tomorrow starts here",
  description: "Scheduling, elevated. Connect your calendar, share your link, and get booked without friction.",
  metadataBase: new URL("https://usemorrow.xyz"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background-full text-text-primary font-sans">
        {children}
      </body>
    </html>
  );
}
