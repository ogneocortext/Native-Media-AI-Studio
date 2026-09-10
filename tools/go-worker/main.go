package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	outputDir string
)

func init() {
	root := os.Getenv("PROJECT_ROOT")
	if root == "" {
		root = "."
	}
	outputDir = filepath.Join(root, "output")
	os.MkdirAll(outputDir, 0755)
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
			job.ID = time.Now().Format("20060102150405")
		}
		job.Status = "pending"
		job.CreatedAt = time.Now()
		jobs[job.ID] = &job
		c.JSON(http.StatusAccepted, job)
	})

	r.GET("/jobs/:id", func(c *gin.Context) {
		job, ok := jobs[c.Param("id")]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
		c.JSON(http.StatusOK, job)
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
		path := filepath.Join(outputDir, filename+".json")
		b, _ := json.MarshalIndent(sidecar.Data, "", "  ")
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
