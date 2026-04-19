import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StyleMD Lab",
  description: "Local-first StyleMD control room and artifact pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
