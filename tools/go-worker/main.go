package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	serviceName = "go-worker"
	version     = "0.4"
	buildTime   = "unknown"
)

var (
	jobs      = make(map[string]*Job)
	jobsMu    sync.RWMutex
	outputDir string
	jobsFile  string
	logger    = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
)

var safeNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type Job struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Status    string                 `json:"status"`
	Payload   map[string]interface{} `json:"payload"`
	Progress  float64                `json:"progress"`
	Result    string                 `json:"result_path,omitempty"`
	Error     string                 `json:"error,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
}

func newJobID() string {
	var value [8]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return time.Now().UTC().Format("20060102150405.000000000")
}

func sidecarPath(filename string) (string, error) {
	if !safeNamePattern.MatchString(filename) || filename == "." || filename == ".." {
		return "", fmt.Errorf("filename must contain only letters, numbers, dots, underscores, or hyphens")
	}
	path := filepath.Join(outputDir, filename+".json")
	rel, err := filepath.Rel(outputDir, path)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid filename")
	}
	return path, nil
}

// persistJobs atomically writes the job store to disk.
// On Windows, os.Rename cannot replace an existing file, so we remove
// the destination first after the temp file is fully written.
func persistJobs() error {
	jobsMu.RLock()
	data, err := json.MarshalIndent(jobs, "", "  ")
	jobsMu.RUnlock()
	if err != nil {
		return err
	}
	tmp := jobsFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	// Sync the temp file to disk before renaming, so we don't lose data
	// if the process crashes between write and rename.
	if f, err := os.Open(tmp); err == nil {
		_ = f.Sync()
		f.Close()
	}
	if err := os.Rename(tmp, jobsFile); err == nil {
		return nil
	}
	// Windows cannot atomically replace an existing destination with Rename.
	// Remove the old snapshot only after the complete temporary file exists.
	if err := os.Remove(jobsFile); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(tmp, jobsFile); err != nil {
		return err
	}
	return nil
}

func init() {
	root := os.Getenv("PROJECT_ROOT")
	if root == "" {
		root = "."
	}
	outputDir = filepath.Join(root, "output")
	jobsFile = filepath.Join(root, "output", ".go-worker-jobs.json")
	_ = os.MkdirAll(outputDir, 0755)
	if data, err := os.ReadFile(jobsFile); err == nil {
		var loaded map[string]*Job
		if json.Unmarshal(data, &loaded) == nil {
			jobs = loaded
			logger.Info("jobs restored from snapshot", "count", len(jobs))
		} else {
			logger.Warn("ignoring invalid job snapshot", "error", err)
		}
	}
}

func main() {
	r := gin.New()
	r.Use(gin.Recovery())

	// CORS for frontend calls
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/health", func(c *gin.Context) {
		jobsMu.RLock()
		count := len(jobs)
		jobsMu.RUnlock()
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": serviceName,
			"version": version,
			"jobs":    count,
		})
	})

	r.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service":   serviceName,
			"version":   version,
			"buildTime": buildTime,
			"goVersion": runtime.Version(),
		})
	})

	r.POST("/jobs", func(c *gin.Context) {
		var job Job
		if err := c.ShouldBindJSON(&job); err != nil {
			logger.Warn("invalid job payload", "error", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if job.ID == "" {
			job.ID = newJobID()
		}
		job.Status = "pending"
		job.CreatedAt = time.Now().UTC()
		jobsMu.Lock()
		if _, exists := jobs[job.ID]; exists {
			jobsMu.Unlock()
			c.JSON(http.StatusConflict, gin.H{"error": "job already exists"})
			return
		}
		jobs[job.ID] = &job
		jobsMu.Unlock()
		if err := persistJobs(); err != nil {
			logger.Error("failed to persist job", "jobID", job.ID, "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "job accepted but could not be persisted"})
			return
		}
		logger.Info("job created", "jobID", job.ID, "type", job.Type)
		c.JSON(http.StatusAccepted, job)
	})

	r.GET("/jobs/:id", func(c *gin.Context) {
		jobsMu.RLock()
		job, ok := jobs[c.Param("id")]
		var snapshot Job
		if ok {
			snapshot = *job
		}
		jobsMu.RUnlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
		c.JSON(http.StatusOK, snapshot)
	})

	r.POST("/jobs/:id/sidecar", func(c *gin.Context) {
		var sidecar struct {
			Data map[string]interface{} `json:"data"`
		}
		if err := c.ShouldBindJSON(&sidecar); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		filename := c.Query("filename")
		if filename == "" {
			filename = c.Param("id")
		}
		path, err := sidecarPath(filename)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		b, err := json.MarshalIndent(sidecar.Data, "", "  ")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sidecar data is not valid JSON"})
			return
		}
		if err := os.WriteFile(path, b, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"written": path})
	})

	port := os.Getenv("GO_WORKER_PORT")
	if port == "" {
		port = "3849"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info("go-worker listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutdown signal received, draining...")

	stop() // restore default signal behavior so a second Ctrl+C force-kills

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped gracefully")
}
