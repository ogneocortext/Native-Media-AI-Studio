import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  useEffect(() => { startAutoRefresh(); return stopAutoRefresh; }, []);

  return (
    <div className="layout-root">
      <Sidebar />
      <main className="layout-main">
        {children}
      </main>
    </div>
  );
}
