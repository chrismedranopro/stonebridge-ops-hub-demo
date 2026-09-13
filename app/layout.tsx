import type { Metadata } from "next";
import { Sora, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Stonebridge — Operations Hub",
  description: "Stonebridge Home Energy Solutions — Energy Efficiency Program Division Operations Hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(jetbrainsMono.variable, "font-sans", geist.variable)}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
