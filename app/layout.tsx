import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "CallYourAgent", description: "Real phone calls for your AI agents." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
