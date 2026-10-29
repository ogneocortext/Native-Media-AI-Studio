package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	sse "github.com/r3labs/sse/v2"
)

const (
	serviceName = "go-dashboard"
	version     = "0.3"
	buildTime   = "unknown"
)

var (
	eventServer = sse.New()
	logger      = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
)

func cors(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	cors(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": serviceName,
		"version": version,
	})
}

func publishHandler(w http.ResponseWriter, r *http.Request) {
	cors(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		logger.Warn("invalid publish payload", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	eventName := "message"
	if t, ok := payload["type"].(string); ok && t != "" {
		eventName = t
	}
	data, _ := json.Marshal(payload)
	eventServer.Publish("events", &sse.Event{
		Event: []byte(eventName),
		Data:  data,
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	cors(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	// Default to the "events" stream when no stream query is provided
	if r.URL.Query().Get("stream") == "" {
		r.URL.RawQuery = "stream=events"
	}
	eventServer.ServeHTTP(w, r)
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	cors(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"service":   serviceName,
		"version":   version,
		"buildTime": buildTime,
		"goVersion": runtime.Version(),
	})
}

func main() {
	eventServer.CreateStream("events")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", healthHandler)
	mux.HandleFunc("/publish", publishHandler)
	mux.HandleFunc("/events", eventsHandler)
	mux.HandleFunc("/version", versionHandler)

	// Heartbeat every 15s to keep intermediary connections alive
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			eventServer.Publish("events", &sse.Event{
				Event:   []byte("heartbeat"),
				Data:    []byte(`{"alive":true}`),
				Comment: []byte("keep-alive"),
			})
		}
	}()

	port := os.Getenv("GO_DASHBOARD_PORT")
	if port == "" {
		port = "3847"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info("go-dashboard listening", "port", port)
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
