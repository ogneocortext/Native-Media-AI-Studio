import { getRemotionEnvironment } from "remotion";
import { useState, useEffect } from "react";

export const StudioBackButton: React.FC = () => {
  const env = getRemotionEnvironment();
  // Only in Remotion Studio preview, not in final renders or Player
  if (!env.isStudio) return null;

  const [frontendUrl, setFrontendUrl] = useState<string>("");

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/config/ports.json");
        if (res.ok) {
          const data = await res.json();
          setFrontendUrl(data.frontend_url || `http://127.0.0.1:${data.frontend_port || 5173}`);
          return;
        }
      } catch { /* ignore */ }
      // Fallback: use same hostname with default frontend port
      if (typeof window !== "undefined") {
        setFrontendUrl(`${window.location.protocol}//${window.location.hostname}:5173`);
      } else {
        setFrontendUrl("http://localhost:5173");
      }
    }
    loadConfig();
  }, []);

  if (!frontendUrl) return null;

  return (
    <a
      href={frontendUrl}
      style={{
        position: "absolute",
        top: 14,
        left: 14,
        zIndex: 9999,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "rgba(12,16,26,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        color: "#eef6ff",
        fontFamily: "DM Mono, monospace",
        fontSize: 12,
        letterSpacing: "0.08em",
        textDecoration: "none",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        cursor: "pointer",
      }}
      title="Back to Native Media AI Studio (frontend)"
      onClick={(e) => {
        // If user came via frontend link, back is cleaner
        if (document.referrer.includes(":5173")) {
          e.preventDefault();
          window.history.back();
        }
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>←</span> Back to Studio
    </a>
  );
};
