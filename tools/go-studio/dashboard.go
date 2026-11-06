package main

// Port 3847 listener — the go-dashboard role: an SSE fan-out mirror.
//
// The FastAPI backend POSTs every SSE message to /publish
// (app/sse/handler.py, fire-and-forget); this listener republishes them on
// /events for external subscribers. The studio frontend reads the backend's
// canonical /api/events instead, so this is optional infrastructure.
//
// Routes: GET /api/health, GET /version, POST /publish, GET /events.

import (
	"encoding/json"
	"net/http"
	"time"

	sse "github.com/r3labs/sse/v2"
)

const (
	dashboardService = "go-dashboard"
	dashboardVersion = "0.3"
)

var dashboardBus = sse.New()

func dashboardMux() *http.ServeMux {
	dashboardBus.CreateStream("events")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler(dashboardService, dashboardVersion, nil))
	mux.HandleFunc("GET /version", versionHandler(dashboardService, dashboardVersion))

	mux.HandleFunc("POST /publish", cors(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			logger.Warn("invalid publish payload", "error", err)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		eventName := "message"
		if t, ok := payload["type"].(string); ok && t != "" {
			eventName = t
		}
		data, _ := json.Marshal(payload)
		dashboardBus.Publish("events", &sse.Event{
			Event: []byte(eventName),
			Data:  data,
		})
		writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
	}))

	mux.HandleFunc("GET /events", cors(func(w http.ResponseWriter, r *http.Request) {
		// Default to the "events" stream when no stream query is provided.
		if r.URL.Query().Get("stream") == "" {
			r.URL.RawQuery = "stream=events"
		}
		dashboardBus.ServeHTTP(w, r)
	}))

	return mux
}

// dashboardHeartbeat keeps SSE connections alive through proxies.
func dashboardHeartbeat() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		dashboardBus.Publish("events", &sse.Event{
			Event:   []byte("heartbeat"),
			Data:    []byte(`{"alive":true}`),
			Comment: []byte("keep-alive"),
		})
	}
}
