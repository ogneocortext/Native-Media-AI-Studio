package main

// Port 3850 listener — the go-gateway role: MCP bridge proxy + health fan-in.
//
// The backend's go_gateway_client calls /proxy/{bridge}/* to reach Unity
// (:7800), Blender (:9876), ComfyUI (:8188), and Ollama (:11434) through one
// hop. In practice only the "unity" bridge is used today
// (api/unity_control.py, api/native_open.py forward the Pipeline server's
// Authorization header through it); the other entries are configured
// capacity for future callers. /health probes every configured bridge in
// parallel with per-service health paths (Ollama /api/tags, ComfyUI
// /system_stats — neither implements /api/health).
//
// Routes: GET /health (per-bridge status+latency), ANY /proxy/{bridge}/{path},
// GET /bridges, GET /version.
// Config: MCP_BRIDGE_ENDPOINTS and MCP_BRIDGE_HEALTH_PATHS
// (name=url / name=path, comma-separated overrides of the defaults).

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	gatewayService = "go-gateway"
	gatewayVersion = "0.4"
)

var (
	bridgeEndpoints = map[string]string{
		"unity":   "http://127.0.0.1:7800",
		"blender": "http://127.0.0.1:9876",
		"comfyui": "http://127.0.0.1:8188",
		"ollama":  "http://127.0.0.1:11434",
	}
	// bridgeHealthPaths maps bridge name to its health check path.
	// Ollama uses /api/tags and ComfyUI /system_stats instead of /api/health,
	// which neither service implements (ComfyUI 404s it -> permanent "degraded").
	bridgeHealthPaths = map[string]string{
		"ollama":  "/api/tags",
		"comfyui": "/system_stats",
	}
	gatewayRequestTimeout = 15 * time.Second
	gatewayHealthTimeout  = 2 * time.Second
	gatewayHealthClient   = &http.Client{Timeout: gatewayHealthTimeout}
	gatewayProxyClient    = &http.Client{Timeout: gatewayRequestTimeout}
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

func bridgeHealth(target, name string) map[string]any {
	healthPath := "/api/health"
	if p, ok := bridgeHealthPaths[name]; ok {
		healthPath = p
	}
	healthURL := target + healthPath
	start := time.Now()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, healthURL, nil)
	if err != nil {
		return map[string]any{"url": target, "status": "down", "latency_ms": 0, "error": err.Error()}
	}
	resp, err := gatewayHealthClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return map[string]any{"url": target, "status": "down", "latency_ms": latency, "error": err.Error()}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	status := "ok"
	if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return map[string]any{"url": target, "status": status, "latency_ms": latency, "code": resp.StatusCode}
}

func gatewayMux() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", cors(func(w http.ResponseWriter, r *http.Request) {
		var wg sync.WaitGroup
		results := make(map[string]any, len(bridgeEndpoints))
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
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": gatewayService,
			"version": gatewayVersion,
			"bridges": results,
		})
	}))

	mux.HandleFunc("/proxy/{bridge}/{path...}", cors(func(w http.ResponseWriter, r *http.Request) {
		bridge := r.PathValue("bridge")
		target, ok := bridgeEndpoints[bridge]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown bridge: " + bridge})
			return
		}
		rest := r.PathValue("path")
		upstream := target + "/" + rest
		if c := r.URL.RawQuery; c != "" {
			upstream += "?" + c
		}

		ctx, cancel := context.WithTimeout(r.Context(), gatewayRequestTimeout)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, r.Method, upstream, r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		req.Header = r.Header.Clone()
		req.Header.Del("Connection")
		req.Header.Del("Proxy-Connection")
		req.Header.Del("Keep-Alive")
		req.Header.Del("Transfer-Encoding")
		req.Header.Del("Upgrade")

		resp, err := gatewayProxyClient.Do(req)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "bridge request failed: " + err.Error()})
			return
		}
		defer resp.Body.Close()

		for k, v := range resp.Header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(resp.StatusCode)
		if _, copyErr := io.Copy(w, resp.Body); copyErr != nil {
			logger.Warn("proxy copy error", "bridge", bridge, "error", copyErr)
		}
	}))

	mux.HandleFunc("GET /bridges", cors(func(w http.ResponseWriter, r *http.Request) {
		names := make([]string, 0, len(bridgeEndpoints))
		for name := range bridgeEndpoints {
			names = append(names, name)
		}
		sort.Strings(names)
		list := make([]map[string]string, 0, len(names))
		for _, name := range names {
			list = append(list, map[string]string{"name": name, "url": bridgeEndpoints[name]})
		}
		writeJSON(w, http.StatusOK, map[string]any{"bridges": list})
	}))

	mux.HandleFunc("GET /version", versionHandler(gatewayService, gatewayVersion))

	return mux
}
