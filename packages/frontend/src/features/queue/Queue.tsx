import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

import {
  Play,
  Loader2,
  XCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Trash2,
  ListOrdered,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Card, StatusBadge, ProgressBar, EmptyState, PageLoader } from "../../components/common";
import type { Job } from "@shared/types";
import {
  useJobStore,
  useJobs,
  useQueueStats,
  useJobLoading,
  useJobError,
  useJobSseConnected,
} from "../../state/jobStore";
import { JobListSection } from "./QueueList";
import { showToast } from "../../utils/toast";

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

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Drill-down view for a single job: full error text, the step-by-step
 * progress timeline, the parameters it was created with, and its output.
 * Clicking a row opens this instead of doing nothing — the data the model
 * already carries was just never surfaced together.
 */
function JobDetailModal({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  const params = job.params as Record<string, unknown> | undefined;
  const steps = job.steps && job.steps.length > 0 ? job.steps : null;
  const statusLabel = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-gray-800">
          <div>
            <h3 className="text-lg font-bold text-white">
              {job.job_type.replace(/_/g, " ")}
            </h3>
            <p className="text-xs text-muted mt-1">
              ID {job.id} · {statusLabel(job.status)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white p-1"
            aria-label="Close"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Timeline */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-2">Timeline</h4>
            <ol className="space-y-2">
              <li className="flex items-start gap-3 text-sm">
                <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
                <div>
                  <p className="text-muted">
                    Created{" "}
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
              {job.started_at && (
                <li className="flex items-start gap-3 text-sm">
                  <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
                  <div>
                    <p className="text-muted">
                      Started {new Date(job.started_at).toLocaleString()}
                    </p>
                  </div>
                </li>
              )}
              {job.completed_at && (
                <li className="flex items-start gap-3 text-sm">
                  <span
                    className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${
                      job.status === "completed"
                        ? "bg-success-text"
                        : "bg-error-text"
                    }`}
                  />
                  <div>
                    <p className="text-muted">
                      {job.status === "completed" ? "Completed" : "Ended"}{" "}
                      {new Date(job.completed_at).toLocaleString()}
                    </p>
                  </div>
                </li>
              )}
            </ol>
          </div>

          {/* Steps */}
          {steps && (
            <div>
              <h4 className="text-sm font-semibold text-white mb-2">Steps</h4>
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 text-sm p-2 rounded-lg bg-muted/10"
                  >
                    {s.status === "completed" ? (
                      <CheckCircle size={14} className="text-success-text shrink-0" />
                    ) : s.status === "running" ? (
                      <Loader2 size={14} className="text-primary animate-spin shrink-0" />
                    ) : s.status === "failed" ? (
                      <AlertCircle size={14} className="text-error-text shrink-0" />
                    ) : (
                      <Clock size={14} className="text-muted shrink-0" />
                    )}
                    <span className="text-white truncate">{s.name}</span>
                    <span className="text-muted ml-auto">
                      {s.status}
                      {s.progress > 0 ? ` · ${(s.progress * 100).toFixed(0)}%` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {job.error && (
            <div>
              <h4 className="text-sm font-semibold text-error-text mb-2">
                Error
              </h4>
              <pre className="text-xs text-muted bg-error/5 border border-error/20 rounded-lg p-3 whitespace-pre-wrap break-words">
                {job.error}
              </pre>
            </div>
          )}

          {/* Params */}
          {params && Object.keys(params).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-white mb-2">
                Parameters
              </h4>
              <pre className="text-xs text-muted bg-muted/10 border border-border rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(params, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {(job.output_path ||
            ((job.result as Record<string, unknown> | null)?.output_path as
              string)) && (
            <div>
              <h4 className="text-sm font-semibold text-white mb-2">
                Output
              </h4>
              <p className="text-xs text-muted break-all">
                {((job.output_path ||
                  (job.result as Record<string, unknown> | null)?.output_path) as
                  string)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Queue() {
  const navigate = useNavigate();
  // Fine-grained selectors: subscribing to the whole store re-renders
  // this page on every job-store change (e.g. isLoading toggling on
  // each poll). State slices and stable action references keep
  // re-renders scoped to the data each part of the UI actually reads.
  const jobs = useJobs();
  const stats = useQueueStats();
  const isLoading = useJobLoading();
  const error = useJobError();
  const sseConnected = useJobSseConnected();
  const fetchJobs = useJobStore((state) => state.fetchJobs);
  const cancelJob = useJobStore((state) => state.cancelJob);
  const retryJob = useJobStore((state) => state.retryJob);
  const deleteJob = useJobStore((state) => state.deleteJob);
  const clearCompleted = useJobStore((state) => state.clearCompleted);
  const clearFailed = useJobStore((state) => state.clearFailed);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Fetch jobs on mount so the queue page reflects the latest state
  // (SSE is managed centrally by Layout.tsx).
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // SSE is managed centrally by Layout.tsx; no per-component connect/disconnect.

  const handleCancel = useCallback((id: string) => {
    setConfirmDialog({
      title: "Cancel Job",
      message: "Are you sure you want to cancel this job? Progress will be lost.",
      confirmLabel: "Cancel Job",
      onConfirm: async () => {
        setConfirmDialog(null);
        setActionLoading(id);
        try {
          await cancelJob(id);
          showToast("Job cancelled", "info");
        } catch (e) {
          console.error("Failed to cancel job:", e);
          showToast("Failed to cancel job", "error");
        } finally {
          setActionLoading(null);
        }
      },
    });
  }, [cancelJob]);

  const handleRetry = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await retryJob(id);
      showToast("Job re-queued", "success");
    } catch (e) {
      console.error("Failed to retry job:", e);
      showToast("Failed to retry job", "error");
    } finally {
      setActionLoading(null);
    }
  }, [retryJob]);

  const handleDelete = useCallback((id: string) => {
    setConfirmDialog({
      title: "Delete Job",
      message: "This will permanently delete this job and its output. This action cannot be undone.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null);
        setActionLoading(id);
        try {
          await deleteJob(id);
          showToast("Job deleted", "success");
        } catch (e) {
          console.error("Failed to delete job:", e);
          showToast("Failed to delete job", "error");
        } finally {
          setActionLoading(null);
        }
      },
    });
  }, [deleteJob]);

  const handleClearCompleted = useCallback(() => {
    const count = stats?.completed || 0;
    setConfirmDialog({
      title: "Clear Completed",
      message: `This will remove ${count} completed job${count === 1 ? "" : "s"} from the queue.`,
      confirmLabel: "Clear All",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await clearCompleted();
          showToast(`Cleared ${count} completed jobs`, "success");
        } catch (e) {
          console.error("Failed to clear completed:", e);
          showToast("Failed to clear completed jobs", "error");
        }
      },
    });
  }, [clearCompleted, stats]);

  const handleClearFailed = useCallback(() => {
    const count = stats?.failed || 0;
    setConfirmDialog({
      title: "Clear Failed",
      message: `This will remove ${count} failed job${count === 1 ? "" : "s"} from the queue.`,
      confirmLabel: "Clear All",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await clearFailed();
          showToast(`Cleared ${count} failed jobs`, "success");
        } catch (e) {
          console.error("Failed to clear failed:", e);
          showToast("Failed to clear failed jobs", "error");
        }
      },
    });
  }, [clearFailed, stats]);

  // Separate jobs by status for organized display
  const runningJob = jobs.find((j) => j.status === "running");
  const pendingJobs = jobs.filter((j) => j.status === "pending" || j.status === "queued");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const cancelledJobs = jobs.filter((j) => j.status === "cancelled");

  if (isLoading && jobs.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Job Queue</h1>
        <Card>
          <PageLoader label="Loading queue…" />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Job Queue</h1>
          <p className="text-muted mt-1">Manage generation jobs</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {sseConnected ? (
              <>
                <Wifi size={16} className="text-success-text" />
                <span className="text-sm text-success-text">Live</span>
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
          <AlertCircle size={18} className="text-error-text mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-error-text font-medium">{getFriendlyError(error)}</p>
            <p className="text-xs text-muted mt-1">
              Try refreshing the page or check the Diagnostics page for more info.
            </p>
            <button className="btn btn-secondary btn-sm mt-2" onClick={() => fetchJobs()}>
              <RotateCcw size={14} className="inline mr-1" />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
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
          <p className="text-2xl font-bold text-success-text">{stats?.completed || 0}</p>
          <p className="text-sm text-muted">Completed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-error-text">{stats?.failed || 0}</p>
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
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20 cursor-pointer hover:bg-primary/10 transition-colors"
                   onClick={() => setSelectedJob(runningJob)}
                   role="button"
                   tabIndex={0}
                   aria-label={`View details for ${runningJob.job_type.replace(/_/g, " ")} job`}
                   onKeyDown={(e) => {
                     if (e.key === "Enter" || e.key === " ") {
                       e.preventDefault();
                       setSelectedJob(runningJob);
                     }
                   }}>
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="p-2 bg-primary/10 rounded-full shrink-0">
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
                        <p className="text-sm text-muted mt-1">{runningJob.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-48 max-w-full">
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
              onSelect={setSelectedJob}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Failed (${failedJobs.length})`}
              titleColor="text-error-text"
              jobs={failedJobs}
              actionLoading={actionLoading}
              onSelect={setSelectedJob}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Completed (${completedJobs.length})`}
              titleColor="text-success-text"
              jobs={completedJobs}
              actionLoading={actionLoading}
              onSelect={setSelectedJob}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
            <JobListSection
              heading={`Cancelled (${cancelledJobs.length})`}
              jobs={cancelledJobs}
              actionLoading={actionLoading}
              onSelect={setSelectedJob}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDelete={handleDelete}
            />
          </div>
        ) : (
          <EmptyState
            title="No jobs in queue"
            description="Nothing is rendering right now. Start a music video and it will appear here with live progress."
            icon={<ListOrdered size={48} />}
            action={{ label: "Create a video", onClick: () => navigate("/music-video-wizard") }}
          />
        )}
      </Card>

      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{confirmDialog.title}</h3>
                <p className="text-sm text-gray-400 mt-1">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
