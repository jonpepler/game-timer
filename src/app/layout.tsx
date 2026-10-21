import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { themeFontVariables, typeStyleFontVariables } from "./fonts";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Game Timer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${typeStyleFontVariables} ${themeFontVariables}`}
    >
      <body>{children}</body>
    </html>
  );
}
