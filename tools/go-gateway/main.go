package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	bridgeEndpoints = map[string]string{
		"unity":    "http://127.0.0.1:7800",
		"blender":  "http://127.0.0.1:9876",
		"comfyui":  "http://127.0.0.1:8188",
		"ollama":   "http://127.0.0.1:11434",
	}
	requestTimeout = 15 * time.Second
)

func init() {
	if extra := os.Getenv("MCP_BRIDGE_ENDPOINTS"); extra != "" {
		for _, pair := range strings.Split(extra, ",") {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 {
				bridgeEndpoints[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
			}
		}
	}
}

func bridgeHealth(target string) map[string]interface{} {
	healthURL := target + "/api/health"
	if target == "http://127.0.0.1:11434" {
		healthURL = target + "/api/tags"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	start := time.Now()
	resp, err := client.Get(healthURL)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return map[string]interface{}{"url": target, "status": "down", "latency_ms": latency, "error": err.Error()}
	}
	defer resp.Body.Close()
	status := "ok"
	if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return map[string]interface{}{"url": target, "status": status, "latency_ms": latency, "code": resp.StatusCode}
}

func healthHandler(c *gin.Context) {
	results := make(map[string]interface{})
	for name, target := range bridgeEndpoints {
		results[name] = bridgeHealth(target)
	}
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "go-gateway",
		"bridges": results,
	})
}

func proxyHandler(c *gin.Context) {
	bridge := c.Param("bridge")
	target, ok := bridgeEndpoints[bridge]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown bridge: " + bridge})
		return
	}
	path := c.Param("path")
	url := target + path
	if c.Request.URL.RawQuery != "" {
		url += "?" + c.Request.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, url, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Header = c.Request.Header.Clone()

	client := &http.Client{Timeout: requestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "bridge request failed: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		for _, vv := range v {
			c.Writer.Header().Add(k, vv)
		}
	}
	c.Status(resp.StatusCode)
	_, copyErr := io.Copy(c.Writer, resp.Body)
	if copyErr != nil {
		log.Printf("go-gateway proxy copy error: %v", copyErr)
	}
}

// Bridge registry
func bridgesHandler(c *gin.Context) {
	list := make([]gin.H, 0, len(bridgeEndpoints))
	for name, url := range bridgeEndpoints {
		list = append(list, gin.H{"name": name, "url": url})
	}
	c.JSON(http.StatusOK, gin.H{"bridges": list})
}

func main() {
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/health", healthHandler)
	r.Any("/proxy/:bridge/*path", proxyHandler)
	r.GET("/bridges", bridgesHandler)

	port := os.Getenv("GO_GATEWAY_PORT")
	if port == "" {
		port = "3850"
	}
	log.Printf("go-gateway listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
