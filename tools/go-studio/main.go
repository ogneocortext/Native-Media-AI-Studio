// Command go-studio is the consolidated local sidecar for Native Media AI
// Studio — one process hosting the five loopback listeners that used to run
// as separate binaries (go-dashboard :3847, go-media :3848, go-worker :3849,
// go-gateway :3850, go-ports :3851).
//
// Consolidation rationale (decision-log D70): the five services were tiny,
// loopback-only HTTP servers that duplicated the same CORS/health/version/
// graceful-shutdown boilerplate. They are merged into one binary with one
// listener per legacy port so every existing caller — backend clients,
// ports.json URLs, port_manager, sse/handler.py broadcasts, and the
// frontend GoServicesCard — keeps working with zero contract changes.
// Each port keeps its legacy route surface and service name in health
// payloads; only the process boundary changed.
//
// Per-listener roles (see each file's doc comment for the full contract):
//
//	dashboard :3847  SSE publish/events mirror (optional; frontend uses
//	                the backend's canonical /api/events)
//	media     :3848  FFmpeg job runner (reserved — no backend callers yet)
//	worker    :3849  JSON sidecar writer for output/ (live: 4 callers)
//	gateway   :3850  MCP bridge proxy (live: unity bridge only)
//	ports     :3851  TCP port-in-use checker (optional accelerator)
//
// Config: per-listener port env vars (GO_DASHBOARD_PORT, GO_MEDIA_PORT,
// GO_WORKER_PORT, GO_GATEWAY_PORT, GO_PORTS_PORT) override the defaults;
// PROJECT_ROOT locates the worker's output dir; MCP_BRIDGE_* override the
// gateway's bridge table.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// listener pairs a legacy port env override with its mux.
type listener struct {
	name    string
	port    string
	mux     func() *http.ServeMux
	onStart func() // optional background goroutine (heartbeats)
}

func listeners() []listener {
	return []listener{
		{
			name:    "dashboard",
			port:    envPort("GO_DASHBOARD_PORT", "3847"),
			mux:     dashboardMux,
			onStart: func() { go dashboardHeartbeat() },
		},
		{
			name:    "media",
			port:    envPort("GO_MEDIA_PORT", "3848"),
			mux:     mediaMux,
			onStart: func() { go mediaHeartbeat() },
		},
		{
			name: "worker",
			port: envPort("GO_WORKER_PORT", "3849"),
			mux:  workerMux,
		},
		{
			name: "gateway",
			port: envPort("GO_GATEWAY_PORT", "3850"),
			mux:  gatewayMux,
		},
		{
			name: "ports",
			port: envPort("GO_PORTS_PORT", "3851"),
			mux:  portsMux,
		},
	}
}

func main() {
	initWorker()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	servers := make([]*http.Server, 0, 5)
	for _, l := range listeners() {
		srv := &http.Server{
			// Loopback-only: every consumer is on this machine. The old
			// gateway/media binaries bound all interfaces; tightening to
			// 127.0.0.1 matches the sidecar contract (D70).
			Addr:              "127.0.0.1:" + l.port,
			Handler:           l.mux(),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       15 * time.Second,
			WriteTimeout:      30 * time.Second,
			MaxHeaderBytes:    1 << 20,
		}
		servers = append(servers, srv)
		if l.onStart != nil {
			l.onStart()
		}
		go func(name, addr string, s *http.Server) {
			logger.Info("listener up", "role", name, "addr", addr)
			if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				logger.Error("listener failed", "role", name, "error", err)
				os.Exit(1)
			}
		}(l.name, srv.Addr, srv)
	}

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Info("shutdown signal received, draining 5 listeners...")

	stop() // restore default signal behavior so a second Ctrl+C force-kills

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for i, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("listener shutdown failed", "role", listeners()[i].name, "error", err)
		}
	}
	fmt.Fprintln(os.Stderr, "go-studio stopped")
}
