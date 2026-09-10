package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	sse "github.com/r3labs/sse/v2"
)

var (
	eventServer = sse.New()
	health      = map[string]string{
		"status":  "ok",
		"service": "go-dashboard",
		"version": "0.3",
	}
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
	json.NewEncoder(w).Encode(health)
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
	json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
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

func main() {
	eventServer.CreateStream("events")
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/publish", publishHandler)
	http.HandleFunc("/events", eventsHandler)

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

	log.Println("go-dashboard listening on :3847")
	log.Fatal(http.ListenAndServe(":3847", nil))
}
