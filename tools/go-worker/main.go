package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

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

var (
	jobs      = make(map[string]*Job)
	jobsMu    sync.RWMutex
	outputDir string
	jobsFile  string
)

var safeNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

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
		} else {
			log.Printf("go-worker: ignoring invalid job snapshot: %v", err)
		}
	}
}

func main() {
	r := gin.Default()

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
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "go-worker"})
	})

	r.POST("/jobs", func(c *gin.Context) {
		var job Job
		if err := c.ShouldBindJSON(&job); err != nil {
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "job accepted but could not be persisted"})
			return
		}
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
	log.Printf("go-worker listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
