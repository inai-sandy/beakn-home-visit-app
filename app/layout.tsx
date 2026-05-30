import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { InstallPrompt } from "@/components/install-prompt";
import { OfflineBanner } from "@/components/offline-banner";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Inter is the M3 default UI typeface per UI/UX §2.3. Loading the four weights
// we use across the type scale (Regular 400, Medium 500, Semibold 600, Bold 700).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Material Symbols Rounded is not in next/font/google's catalog (it indexes
// only the standard text-typeface families). We load it as a normal Google
// Fonts stylesheet exposing the full variable axes (opsz, wght, FILL, GRAD)
// so the <Icon> component can tune them per the M3 icon spec (UI/UX §2.4).
const MATERIAL_SYMBOLS_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block";

export const metadata: Metadata = {
  title: "Beakn Home Visit App",
  description:
    "Beakn Home Visit App — mobile-first field-ops PWA for sales home visits.",
  applicationName: "Beakn",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Beakn",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  // PWA shells render edge-to-edge on devices with display cutouts; cover the safe areas.
  viewportFit: "cover",
  initialScale: 1,
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_HREF} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <OfflineBanner />
            {children}
            <InstallPrompt />
            <Toaster richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
