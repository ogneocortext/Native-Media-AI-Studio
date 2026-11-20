import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { startAutoRefresh, stopAutoRefresh } from "../../state/jobStore";
import { useUIStore } from "../../state/uiStore";
import { useNsfwStore } from "../../state/nsfwStore";
import { useHealthStore } from "../../state/healthStore";
import { useJobStore } from "../../state/jobStore";
import { connectNotificationSSE, disconnectNotificationSSE } from "../../state/notificationStore";
import { NotificationBell } from "../notifications/NotificationBell";
import { ConnectionStatusDot } from "../notifications/ConnectionStatusDot";
import { MayaPresence } from "../../features/presence/MayaPresence";
import pkg from "../../../package.json";

interface LayoutProps {
  children: React.ReactNode;
}

// Single source of truth: package.json version (bumped per release).
const APP_VERSION = pkg.version;
const COPYRIGHT = "Internext Ventures LLC";

// Expose stores on window for test harnesses / debug tooling.
import { sseService } from "../../services/sseService";

declare global {
  interface Window {
    __healthStore?: typeof useHealthStore;
    __jobStore?: typeof useJobStore;
    __sseService?: SSEServiceLike;
  }
}

interface SSEServiceLike {
  feedMessage: (message: Record<string, unknown>) => void;
}

export function Layout({ children }: LayoutProps) {
  useEffect(() => {
    // Expose stores + SSE service for test harnesses that read state /
    // dispatch events without React rendering.
    (window as Window).__healthStore = useHealthStore;
    (window as Window).__jobStore = useJobStore;
    (window as Window).__sseService = sseService;

    startAutoRefresh();
    // Visibility gate for NSFW-flagged media. Loaded once at the shell so the
    // nav entry and the /nsfw route agree without each fetching settings.
    void useNsfwStore.getState().load();
    // Centralize SSE: connect once here so the EventSource is not
    // opened/closed by every mount/unmount of Sidebar/Queue/etc.
    useHealthStore.getState().connectSSE();
    useJobStore.getState().connectSSE();
    connectNotificationSSE();
    return () => {
      stopAutoRefresh();
      useHealthStore.getState().disconnectSSE();
      useJobStore.getState().disconnectSSE();
      disconnectNotificationSSE();
    };
  }, []);
  const { focusMode } = useUIStore();

  return (
    <div className={`layout-root${focusMode ? " layout-focus-mode" : ""}`}>
      <div className="layout-topbar">
        <ConnectionStatusDot />
        <MayaPresence />
        <NotificationBell />
      </div>
      <Sidebar />
      <div className="layout-content">
        <main className="layout-main">{children}</main>
        <footer className="layout-footer">
          <span className="layout-footer-version">V{APP_VERSION}</span>
          <Link to="/about" className="layout-footer-copyright hover:text-foreground transition-colors">
            © 2025–2027 {COPYRIGHT}
          </Link>
        </footer>
      </div>
    </div>
  );
}
