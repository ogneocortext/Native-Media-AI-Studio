import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  Loader2,
  XCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Trash2,
} from "lucide-react";
import { Card, StatusBadge, ProgressBar, EmptyState } from "../../components/common";
import { useJobStore } from "../../state/jobStore";
import { JobListSection } from "./QueueList";

/**
 * Convert technical error messages to user-friendly messages.
 */
function getFriendlyError(error: string): string {
  if (error.includes("Failed to fetch") || error.includes("NetworkError")) {
    return "Unable to connect to the backend server. Please ensure the backend is running.";
  }
  if (error.includes("500") || error.includes("Internal Server Error")) {
    return "The server encountered an error. Please try again or check the logs.";
  }
  if (error.includes("404") || error.includes("Not Found")) {
    return "The requested resource was not found.";
  }
  if (error.includes("403") || error.includes("Forbidden")) {
    return "You don't have permission to perform this action.";
  }
  if (error.includes("timeout") || error.includes("Timeout")) {
    return "The request timed out. Please try again.";
  }
  if (error.includes("ComfyUI")) {
    return "ComfyUI is not responding. Please check the Health page to start it.";
  }
  if (error.includes("Ollama")) {
    return "Ollama is not responding. Please check the Health page.";
  }
  // Return the original error if no friendly match
  return error.length > 100 ? "An unexpected error occurred. Please try again." : error;
}

export function Queue() {
  const {
    jobs,
    stats,
    isLoading,
    error,
    sseConnected,
    fetchJobs,
    cancelJob,
    retryJob,
    deleteJob,
    clearCompleted,
    clearFailed,
  } = useJobStore();

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch jobs on mount so the queue page reflects the latest state
  // (SSE is managed centrally by Layout.tsx).
  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchJobs]);

  // SSE is managed centrally by Layout.tsx; no per-component connect/disconnect.

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this job?")) return;
    setActionLoading(id);
    try {
      await cancelJob(id);
    } catch (e) {
      console.error("Failed to cancel job:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      await retryJob(id);
    } catch (e) {
      console.error("Failed to retry job:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this job permanently?")) return;
    setActionLoading(id);
    try {
      await deleteJob(id);
    } catch (e) {
      console.error("Failed to delete job:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearCompleted = async () => {
    if (!confirm(`Clear ${stats?.completed || 0} completed jobs?`)) return;
    try {
      await clearCompleted();
    } catch (e) {
      console.error("Failed to clear completed:", e);
    }
  };

  const handleClearFailed = async () => {
    if (!confirm(`Clear ${stats?.failed || 0} failed jobs?`)) return;
    try {
      await clearFailed();
    } catch (e) {
      console.error("Failed to clear failed:", e);
    }
  };

  // Separate jobs by status for organized display
  const runningJob = jobs.find((j) => j.status === "running");
  const pendingJobs = jobs.filter(
    (j) => j.status === "pending" || j.status === "queued",
  );
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const cancelledJobs = jobs.filter((j) => j.status === "cancelled");

  if (isLoading && jobs.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Job Queue</h1>
        <Card>
          <p className="text-muted text-center py-8">Loading...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Job Queue</h1>
          <p className="text-muted mt-1">Manage generation jobs</p>
        </div>

        <div className="flex items-center gap-4">
          {/* SSE Status Indicator */}
          <div className="flex items-center gap-2">
            {sseConnected ? (
              <>
                <Wifi size={16} className="text-success" />
                <span className="text-sm text-success">Live</span>
              </>
            ) : (
              <>
                <WifiOff size={16} className="text-muted" />
                <span className="text-sm text-muted">Polling</span>
              </>
            )}
          </div>

          {stats && stats.failed > 0 && (
            <button className="btn btn-secondary" onClick={handleClearFailed}>
              <Trash2 size={16} className="inline mr-2" />
              Clear Failed
            </button>
          )}

          {stats && stats.completed > 0 && (
            <button className="btn btn-secondary" onClick={handleClearCompleted}>
              <Trash2 size={16} className="inline mr-2" />
              Clear Completed
            </button>
          )}
        </div>
      </div>

      {/* Error Display - Only show meaningful errors, not transient network issues */}
      {error && !error.includes("SSE") && !error.includes("Failed to fetch") && (
        <div className="mb-4 p-4 bg-error/10 border border-error/20 rounded-xl flex items-start gap-3 animate-fade-in">
          <AlertCircle size={18} className="text-error mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-error font-medium">{getFriendlyError(error)}</p>
            <p className="text-xs text-muted mt-1">Try refreshing the page or check the Diagnostics page for more info.</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-6 mb-6">
        <Card className="text-center">
          <p className="text-2xl font-bold">{stats?.total_jobs || 0}</p>
          <p className="text-sm text-muted">Total</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-warning">
            {(stats?.pending || 0) + (stats?.queued || 0)}
          </p>
          <p className="text-sm text-muted">Pending</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-primary">{stats?.running || 0}</p>
          <p className="text-sm text-muted">Running</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-success">{stats?.completed || 0}</p>
          <p className="text-sm text-muted">Completed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-error">{stats?.failed || 0}</p>
          <p className="text-sm text-muted">Failed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-muted">{stats?.cancelled || 0}</p>
          <p className="text-sm text-muted">Cancelled</p>
        </Card>
      </div>

      {/* Job List */}
      <Card>
        {jobs.length > 0 ? (
          <div className="space-y-4">
            {/* Running Job Section */}
            {runningJob && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted mb-3 uppercase tracking-wide">
                  Currently Running
                </h3>
                <div className="flex items-center justify-between p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Play size={20} className="text-primary" />
                    </div>
                    <div>
                      <p className="font-medium capitalize">
                        {runningJob.job_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted">
                        ID: {runningJob.id.slice(0, 8)}... | Started:{" "}
                        {runningJob.started_at
                          ? new Date(runningJob.started_at).toLocaleString()
                          : "N/A"}
                      </p>
                      {runningJob.message && (
                        <p className="text-sm text-muted mt-1">
                          {runningJob.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-48">
                      <ProgressBar progress={runningJob.progress} />
                      <p className="text-xs text-muted mt-1 text-right">
                        {(runningJob.progress * 100).toFixed(1)}%
                      </p>
                    </div>

                    <StatusBadge status={runningJob.status} />

                    <button
                      className="btn btn-secondary p-2"
                      onClick={() => handleCancel(runningJob.id)}
                      disabled={actionLoading === runningJob.id}
                      title="Cancel"
                    >
                      {actionLoading === runningJob.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <JobListSection
              heading={`Queue (${pendingJobs.length} pending)`}
              jobs={pendingJobs}
              isPending
              actionLoading={actionLoading}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Failed (${failedJobs.length})`}
              titleColor="text-error"
              jobs={failedJobs}
              actionLoading={actionLoading}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Completed (${completedJobs.length})`}
              titleColor="text-success"
              jobs={completedJobs}
              actionLoading={actionLoading}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Cancelled (${cancelledJobs.length})`}
              jobs={cancelledJobs}
              actionLoading={actionLoading}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
          </div>
        ) : (
          <EmptyState
            title="No jobs in queue"
            description="Create a job from one of the workspace pages"
          >
            <div className="flex items-center justify-center gap-3 mt-4">
              <Link to="/music-video-wizard" className="btn btn-primary">
                <Play size={16} className="inline mr-2" />
                Music Video
              </Link>
              <Link to="/image-generation" className="btn btn-secondary">
                <Play size={16} className="inline mr-2" />
                Image Gen
              </Link>
            </div>
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
