package main

// Shared helpers used by every listener: CORS, JSON responses, the standard
// health/version payloads, and the crypto-random job ID generator.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"time"
)

var logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
	Level: slog.LevelInfo,
}))

const buildTime = "unknown"

// cors wraps a handler with the permissive local-dev CORS policy every
// listener historically used. OPTIONS preflights short-circuit.
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}

// healthHandler returns the standard liveness payload. serviceName keeps the
// legacy per-listener identity ("go-dashboard", "go-media", ...) so existing
// health checks and the frontend GoServicesCard see unchanged responses.
func healthHandler(serviceName, version string, extra map[string]any) http.HandlerFunc {
	return cors(func(w http.ResponseWriter, r *http.Request) {
		payload := map[string]any{
			"status":  "ok",
			"service": serviceName,
			"version": version,
		}
		for k, v := range extra {
			payload[k] = v
		}
		writeJSON(w, http.StatusOK, payload)
	})
}

func versionHandler(serviceName, version string) http.HandlerFunc {
	return cors(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"service":   serviceName,
			"version":   version,
			"buildTime": buildTime,
			"goVersion": runtime.Version(),
		})
	})
}

// newJobID returns a random 64-bit hex ID, falling back to a nanosecond
// timestamp if the crypto source fails.
func newJobID() string {
	var value [8]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return time.Now().UTC().Format("20060102150405.000000000")
}

func envPort(name, fallback string) string {
	if p := os.Getenv(name); p != "" {
		return p
	}
	return fallback
}
