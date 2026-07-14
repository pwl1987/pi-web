import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Noto_Sans_Mono } from "next/font/google";
import { ThemeLangInit } from "@/components/ThemeLangInit";
import "katex/dist/katex.min.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export const metadata: Metadata = {
  title: "Pi Agent Web",
  description: "Pi Coding Agent Web Interface",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("pi-theme")?.value;
  const lang = cookieStore.get("pi-language")?.value;
  const isDark = theme === "dark";
  const htmlLang = lang === "zh" ? "zh" : "en";

  return (
    <html
      lang={htmlLang}
      translate="no"
      className={`${notoSansMono.variable} notranslate${isDark ? " dark" : ""}`}
      {...(lang === "zh" ? { "data-lang": "zh" } : {})}
      suppressHydrationWarning
    >
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body
        translate="no"
        className="notranslate"
        style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
      >
        <ThemeLangInit />
        {children}
      </body>
    </html>
  );
}
