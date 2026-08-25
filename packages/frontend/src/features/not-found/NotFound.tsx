/**
 * NotFound Page — 404 error page for unknown routes.
 */

import { Link } from "react-router-dom";
import { Home, AlertTriangle } from "lucide-react";

export function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle size={32} className="text-amber-500" />
        </div>
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-lg text-muted mb-6">Page not found</p>
        <p className="text-sm text-muted mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Home size={18} />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
