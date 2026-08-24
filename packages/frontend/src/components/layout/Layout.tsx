import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";

interface LayoutProps { children: React.ReactNode; }

const APP_VERSION = "1.0.0";
const COPYRIGHT = "InterGalactic Media Productions LLC";

export function Layout({ children }: LayoutProps) {
  useEffect(() => { startAutoRefresh(); return stopAutoRefresh; }, []);

  return (
    <div className="layout-root">
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
