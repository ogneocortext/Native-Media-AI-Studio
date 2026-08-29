import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";
import { useUIStore } from "../../state/uiStore";

interface LayoutProps { children: React.ReactNode; }

const APP_VERSION = "1.0.0";
const COPYRIGHT = "InterGalactic Media Productions LLC";

export function Layout({ children }: LayoutProps) {
  useEffect(() => { startAutoRefresh(); return stopAutoRefresh; }, []);
  const { focusMode } = useUIStore();

  return (
    <div className={`layout-root${focusMode ? " layout-focus-mode" : ""}`}>
      <Sidebar />
      <div className="layout-content">
        <main className="layout-main">
          {children}
        </main>
        <footer className="layout-footer">
          <span className="layout-footer-version">v{APP_VERSION}</span>
          <span className="layout-footer-copyright">© 2026 {COPYRIGHT}</span>
        </footer>
      </div>
    </div>
  );
}
