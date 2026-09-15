import type { Metadata, Viewport } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Workbench Aurora — Focus, Goals, Time",
  description:
    "A local-first productivity workbench: goals, focus sessions, habits, journal, dual calendar and reports — in one calm cockpit.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d8f7d",
};

const themeInit = `(function(){try{var raw=localStorage.getItem('workbench_aurora_v3');var t='light';if(raw){var p=JSON.parse(raw);if(p&&p.state&&p.state.theme){t=p.state.theme;}}if(t==='dark'){document.documentElement.classList.add('dark');}else if(t==='prism'){document.documentElement.classList.add('prism');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body
        className={`${inter.variable} ${sora.variable} ${jetbrains.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
