package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	serviceName = "go-gateway"
	version     = "0.4"
	buildTime   = "unknown"
)

var (
	bridgeEndpoints = map[string]string{
		"unity":   "http://127.0.0.1:7800",
		"blender": "http://127.0.0.1:9876",
		"comfyui": "http://127.0.0.1:8188",
		"ollama":  "http://127.0.0.1:11434",
	}
	// bridgeHealthPaths maps bridge name to its health check path.
	// Ollama uses /api/tags instead of /api/health.
	bridgeHealthPaths = map[string]string{
		"ollama": "/api/tags",
	}
	requestTimeout = 15 * time.Second
	healthTimeout  = 2 * time.Second
	healthClient   = &http.Client{Timeout: healthTimeout}
	proxyClient    = &http.Client{Timeout: requestTimeout}
	logger         = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	shutdownSignals = make(chan os.Signal, 1)
)

func init() {
	if extra := os.Getenv("MCP_BRIDGE_ENDPOINTS"); extra != "" {
		for _, pair := range strings.Split(extra, ",") {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 {
				name := strings.TrimSpace(kv[0])
				value := strings.TrimRight(strings.TrimSpace(kv[1]), "/")
				if name != "" {
					if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" && parsed.Host != "" {
						bridgeEndpoints[name] = value
						logger.Info("bridge endpoint configured", "name", name, "url", value)
					} else {
						logger.Warn("ignoring invalid MCP_BRIDGE_ENDPOINTS entry", "entry", pair)
					}
				}
			}
		}
	}
	if hp := os.Getenv("MCP_BRIDGE_HEALTH_PATHS"); hp != "" {
		for _, pair := range strings.Split(hp, ",") {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 {
				name := strings.TrimSpace(kv[0])
				path := strings.TrimSpace(kv[1])
				if name != "" && path != "" {
					if !strings.HasPrefix(path, "/") {
						path = "/" + path
					}
					bridgeHealthPaths[name] = path
				}
			}
		}
	}
}

func bridgeHealth(target, name string) map[string]interface{} {
	healthPath := "/api/health"
	if p, ok := bridgeHealthPaths[name]; ok {
		healthPath = p
	}
	healthURL := target + healthPath
	start := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, healthURL, nil)
	if err != nil {
		return map[string]interface{}{"url": target, "status": "down", "latency_ms": 0, "error": err.Error()}
	}
	resp, err := healthClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return map[string]interface{}{"url": target, "status": "down", "latency_ms": latency, "error": err.Error()}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	status := "ok"
	if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return map[string]interface{}{"url": target, "status": status, "latency_ms": latency, "code": resp.StatusCode}
}

func healthHandler(c *gin.Context) {
	var wg sync.WaitGroup
	results := make(map[string]interface{}, len(bridgeEndpoints))
	var mu sync.Mutex
	for name, target := range bridgeEndpoints {
		name, target := name, target
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := bridgeHealth(target, name)
			mu.Lock()
			results[name] = result
			mu.Unlock()
		}()
	}
	wg.Wait()
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": serviceName,
		"version": version,
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, c.Request.Method, url, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Header = c.Request.Header.Clone()
	req.Header.Del("Connection")
	req.Header.Del("Proxy-Connection")
	req.Header.Del("Keep-Alive")
	req.Header.Del("Transfer-Encoding")
	req.Header.Del("Upgrade")

	resp, err := proxyClient.Do(req)
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
		logger.Warn("proxy copy error", "bridge", bridge, "error", copyErr)
	}
}

// Bridge registry
func bridgesHandler(c *gin.Context) {
	list := make([]gin.H, 0, len(bridgeEndpoints))
	names := make([]string, 0, len(bridgeEndpoints))
	for name := range bridgeEndpoints {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		list = append(list, gin.H{"name": name, "url": bridgeEndpoints[name]})
	}
	c.JSON(http.StatusOK, gin.H{"bridges": list})
}

func versionHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service":   serviceName,
		"version":   version,
		"buildTime": buildTime,
		"goVersion": runtime.Version(),
	})
}

func main() {
	r := gin.New()
	r.Use(gin.Recovery())
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
	r.GET("/version", versionHandler)

	port := os.Getenv("GO_GATEWAY_PORT")
	if port == "" {
		port = "3850"
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
		logger.Info("go-gateway listening", "port", port)
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
