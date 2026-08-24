import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  useEffect(() => { startAutoRefresh(); return stopAutoRefresh; }, []);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      {/* Main — on mobile leave room for hamburger (top-0) and allow full width */}
      <main className="main-content flex-1 overflow-auto min-w-0 pt-0 lg:pt-0">
        {/* Mobile spacer for hamburger button */}
        <div className="h-14 lg:hidden shrink-0" aria-hidden />
        {children}
      </main>
    </div>
  );
}
