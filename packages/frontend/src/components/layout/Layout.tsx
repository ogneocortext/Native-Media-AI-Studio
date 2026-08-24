import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  useEffect(() => { startAutoRefresh(); return stopAutoRefresh; }, []);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#0a0a0f" }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: "auto", minWidth: 0, height: "100%", background: "#0a0a0f" }}>
        {children}
      </main>
    </div>
  );
}
