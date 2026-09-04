import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";
import { useUIStore } from "../../state/uiStore";
import { useHealthStore } from "../../state/healthStore";
import { useJobStore } from "../../state/jobStore";

interface LayoutProps { children: React.ReactNode; }

const APP_VERSION = "1.0.0";
const COPYRIGHT = "InterGalactic Media Productions LLC";

export function Layout({ children }: LayoutProps) {
  useEffect(() => {
    startAutoRefresh();
    // Centralize SSE: connect once here so the EventSource is not
    // opened/closed by every mount/unmount of Sidebar/Queue/etc.
    useHealthStore.getState().connectSSE();
    useJobStore.getState().connectSSE();
    return () => {
      stopAutoRefresh();
      useHealthStore.getState().disconnectSSE();
      useJobStore.getState().disconnectSSE();
    };
  }, []);
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
