package main

// Port 3851 listener — the go-ports role: TCP port-in-use checker.
//
// The backend's core/port_manager uses it as an optional fast path for port
// checks; when this listener is down the manager falls back to its own
// socket probe, so it is an accelerator, not a dependency. A port counts as
// "in use" when a TCP connect to 127.0.0.1 succeeds within 1s.
//
// Routes: GET /api/health, GET /version, GET /check/{port},
// GET /scan?ports=8000,5173 (max 100, deduped, checked in parallel).

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	portsService = "go-ports"
	portsVersion = "0.1"
)

func isPortInUse(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func parsePortParam(raw string) (int, bool) {
	p, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || p < 1 || p > 65535 {
		return 0, false
	}
	return p, true
}

func portsMux() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", healthHandler(portsService, portsVersion, nil))
	mux.HandleFunc("GET /version", versionHandler(portsService, portsVersion))

	mux.HandleFunc("GET /check/{port}", cors(func(w http.ResponseWriter, r *http.Request) {
		p, ok := parsePortParam(r.PathValue("port"))
		if !ok {
			writeErr(w, http.StatusBadRequest, "invalid port")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"port":     p,
			"in_use":   isPortInUse(p),
			"protocol": "tcp",
		})
	}))

	mux.HandleFunc("GET /scan", cors(func(w http.ResponseWriter, r *http.Request) {
		portsParam := r.URL.Query().Get("ports")
		if portsParam == "" {
			writeErr(w, http.StatusBadRequest, "?ports=8000,5173,3847 required")
			return
		}
		parts := strings.Split(portsParam, ",")
		if len(parts) > 100 {
			writeErr(w, http.StatusBadRequest, "at most 100 ports may be scanned")
			return
		}
		ports := make([]int, 0, len(parts))
		seen := make(map[int]struct{}, len(parts))
		for _, part := range parts {
			p, ok := parsePortParam(part)
			if !ok {
				writeErr(w, http.StatusBadRequest, "ports must be integers between 1 and 65535")
				return
			}
			if _, exists := seen[p]; !exists {
				seen[p] = struct{}{}
				ports = append(ports, p)
			}
		}
		results := make([]map[string]any, len(ports))
		var wg sync.WaitGroup
		for i, p := range ports {
			wg.Add(1)
			go func(index, port int) {
				defer wg.Done()
				results[index] = map[string]any{"port": port, "in_use": isPortInUse(port)}
			}(i, p)
		}
		wg.Wait()
		writeJSON(w, http.StatusOK, map[string]any{
			"ports": results,
			"total": len(results),
		})
	}))

	return mux
}
