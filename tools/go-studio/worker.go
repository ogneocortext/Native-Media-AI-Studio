package main

// Port 3849 listener — the go-worker role: job registry + JSON sidecar writer.
//
// The live surface is POST /jobs/{id}/sidecar: the backend's
// services/go_worker_client.py calls it from comfyui_workflow_handler,
// export_matrix, image_generator, and storyboard_generator to write
// <PROJECT_ROOT>/output/<name>.json sidecars off the Python event loop.
// The /jobs registry (create/get + snapshot persistence) is maintained but
// currently has no backend callers.
//
// Sidecar filenames are validated by safeNamePattern plus a path-containment
// check, so callers cannot write outside the output directory.
//
// Routes: GET /health, GET /version, POST /jobs, GET /jobs/{id},
// POST /jobs/{id}/sidecar?filename=.
// Config: PROJECT_ROOT (default ".") — output dir is <root>/output, snapshot
// is output/.go-worker-jobs.json.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	workerService = "go-worker"
	workerVersion = "0.4"
)

var (
	workerJobs     = make(map[string]*WorkerJob)
	workerMu       sync.RWMutex
	workerOutDir   string
	workerJobsFile string
)

var safeNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// WorkerJob is the persisted registry entry. Only the sidecar write path is
// exercised by the backend today; the registry fields are kept for callers
// that adopt job tracking later.
type WorkerJob struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Status    string         `json:"status"`
	Payload   map[string]any `json:"payload"`
	Progress  float64        `json:"progress"`
	Result    string         `json:"result_path,omitempty"`
	Error     string         `json:"error,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

func sidecarPath(filename string) (string, error) {
	if !safeNamePattern.MatchString(filename) || filename == "." || filename == ".." {
		return "", fmt.Errorf("filename must contain only letters, numbers, dots, underscores, or hyphens")
	}
	path := filepath.Join(workerOutDir, filename+".json")
	rel, err := filepath.Rel(workerOutDir, path)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid filename")
	}
	return path, nil
}

// persistWorkerJobs atomically writes the job store to disk.
// On Windows, os.Rename cannot replace an existing file, so we remove
// the destination first after the temp file is fully written.
func persistWorkerJobs() error {
	workerMu.RLock()
	data, err := json.MarshalIndent(workerJobs, "", "  ")
	workerMu.RUnlock()
	if err != nil {
		return err
	}
	tmp := workerJobsFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	// Sync the temp file to disk before renaming, so we don't lose data
	// if the process crashes between write and rename.
	if f, err := os.Open(tmp); err == nil {
		_ = f.Sync()
		f.Close()
	}
	if err := os.Rename(tmp, workerJobsFile); err == nil {
		return nil
	}
	// Windows cannot atomically replace an existing destination with Rename.
	// Remove the old snapshot only after the complete temporary file exists.
	if err := os.Remove(workerJobsFile); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(tmp, workerJobsFile); err != nil {
		return err
	}
	return nil
}

func initWorker() {
	root := os.Getenv("PROJECT_ROOT")
	if root == "" {
		root = "."
	}
	workerOutDir = filepath.Join(root, "output")
	workerJobsFile = filepath.Join(root, "output", ".go-worker-jobs.json")
	_ = os.MkdirAll(workerOutDir, 0755)
	if data, err := os.ReadFile(workerJobsFile); err == nil {
		var loaded map[string]*WorkerJob
		if json.Unmarshal(data, &loaded) == nil {
			workerJobs = loaded
			logger.Info("jobs restored from snapshot", "count", len(workerJobs))
		} else {
			logger.Warn("ignoring invalid job snapshot", "error", err)
		}
	}
}

func workerMux() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", cors(func(w http.ResponseWriter, r *http.Request) {
		workerMu.RLock()
		count := len(workerJobs)
		workerMu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": workerService,
			"version": workerVersion,
			"jobs":    count,
		})
	}))

	mux.HandleFunc("GET /version", versionHandler(workerService, workerVersion))

	mux.HandleFunc("POST /jobs", cors(func(w http.ResponseWriter, r *http.Request) {
		var job WorkerJob
		if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
			logger.Warn("invalid job payload", "error", err)
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if job.ID == "" {
			job.ID = newJobID()
		}
		job.Status = "pending"
		job.CreatedAt = time.Now().UTC()
		workerMu.Lock()
		if _, exists := workerJobs[job.ID]; exists {
			workerMu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "job already exists"})
			return
		}
		workerJobs[job.ID] = &job
		workerMu.Unlock()
		if err := persistWorkerJobs(); err != nil {
			logger.Error("failed to persist job", "jobID", job.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "job accepted but could not be persisted"})
			return
		}
		logger.Info("job created", "jobID", job.ID, "type", job.Type)
		writeJSON(w, http.StatusAccepted, job)
	}))

	mux.HandleFunc("GET /jobs/{id}", cors(func(w http.ResponseWriter, r *http.Request) {
		workerMu.RLock()
		job, ok := workerJobs[r.PathValue("id")]
		var snapshot WorkerJob
		if ok {
			snapshot = *job
		}
		workerMu.RUnlock()
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
			return
		}
		writeJSON(w, http.StatusOK, snapshot)
	}))

	mux.HandleFunc("POST /jobs/{id}/sidecar", cors(func(w http.ResponseWriter, r *http.Request) {
		var sidecar struct {
			Data map[string]any `json:"data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&sidecar); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		filename := r.URL.Query().Get("filename")
		if filename == "" {
			filename = r.PathValue("id")
		}
		path, err := sidecarPath(filename)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		b, err := json.MarshalIndent(sidecar.Data, "", "  ")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sidecar data is not valid JSON"})
			return
		}
		if err := os.WriteFile(path, b, 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"written": path})
	}))

	return mux
}
