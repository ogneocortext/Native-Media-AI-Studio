/**
 * Maya's Office — page rendered entirely from server-side config.
 *
 * The config lives in ``config/office.json`` and is served by
 * ``GET /api/office/config``. Maya can change what the page says by editing
 * the config through the API — no rebuild, no restart.
 */

import { useEffect, useState } from "react";

import { getApiBase } from "@/services/api/core";

interface OfficeConfig {
  greeting: string;
  currently: string;
  featured_plate: string;
  accent: string;
  updated_at: string | null;
}

export function OfficePage() {
  const [config, setConfig] = useState<OfficeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = getApiBase();

    fetch(`${base}/api/office/config`, { signal: undefined as unknown as AbortSignal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`config fetch failed: ${res.status}`);
        }
        return (await res.json()) as OfficeConfig;
      })
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 pb-10">
        <div className="text-muted text-xs text-center py-4">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 pb-10">
        <h1 className="text-2xl font-bold text-foreground">Maya's Office</h1>
        <p className="text-red-400 text-sm">
          Unable to load office config: {error}
        </p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 pb-10">
        <h1 className="text-2xl font-bold text-foreground">Maya's Office</h1>
        <p className="text-gray-400 text-sm">No office config available.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 pb-10">
      <div className="relative pb-2">
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ color: config.accent }}
        >
          {config.greeting}
        </h1>
        <div
          className="h-1 w-16 rounded-full"
          style={{ backgroundColor: config.accent }}
        />
      </div>

      {config.featured_plate && (
        <div>
          <img
            src={config.featured_plate}
            alt="Maya"
            className="max-w-full h-auto rounded-md border border-border"
          />
        </div>
      )}

      <p className="text-gray-300 text-sm leading-relaxed">
        {config.currently}
      </p>

      {config.updated_at && (
        <p className="text-xs text-gray-500 border-t border-border pt-2">
          Config updated {config.updated_at}
        </p>
      )}
    </div>
  );
}
