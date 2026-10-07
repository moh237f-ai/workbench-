import type { Metadata, Viewport } from "next";
// Fully offline fonts — bundled at build time, zero network at build or runtime.
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/vazirmatn"; // Persian/Arabic script — first-class fallback
import "./globals.css";

export const metadata: Metadata = {
  title: "Workbench Aurora — Focus, Goals, Time",
  description:
    "A local-first productivity workbench: goals, focus sessions, habits, journal, dual calendar and reports — in one calm cockpit.",
  icons: {
    icon: "/logo.svg",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
