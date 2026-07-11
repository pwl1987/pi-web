import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      translate="no"
      className={`${notoSansMono.variable} notranslate`}
      suppressHydrationWarning
    >
      <head>
        <meta name="google" content="notranslate" />
        {/* Preload theme + lang before first paint to eliminate FOUC.
            Must be inline (blocking) so <html> classes are set before
            the browser paints the first frame. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark");var l=localStorage.getItem("pi-language");if(l==="zh"){var d=document.documentElement;d.setAttribute("data-lang","zh");d.lang="zh"}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        translate="no"
        className="notranslate"
        style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
      >
        {children}
      </body>
    </html>
  );
}
