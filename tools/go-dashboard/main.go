package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

var (
	eventBroadcast = make(chan map[string]interface{}, 256)
	sseClients    = make(map[chan map[string]interface{}]struct{})
	clientsMu     sync.Mutex
)

func corsMiddleware(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
}

func main() {
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		corsMiddleware(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "go-dashboard",
		})
	})

	http.HandleFunc("/publish", func(w http.ResponseWriter, r *http.Request) {
		corsMiddleware(w, r)
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
		select {
		case eventBroadcast <- payload:
		default:
			// Drop event if channel full to avoid blocking backend
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
	})

	http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		corsMiddleware(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		client := make(chan map[string]interface{}, 64)
		clientsMu.Lock()
		sseClients[client] = struct{}{}
		clientsMu.Unlock()

		// Send initial connection event
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"event":     "connected",
			"data":      map[string]string{"service": "go-dashboard", "status": "running"},
			"timestamp": time.Now().Format(time.RFC3339),
		})
		flusher.Flush()

		notify := r.Context().Done()

		go func() {
			for {
				select {
				case data, ok := <-client:
					if !ok {
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]interface{}{
						"event":     data["type"],
						"data":      data,
						"timestamp": time.Now().Format(time.RFC3339),
					})
					flusher.Flush()
				case <-notify:
					close(client)
					return
				}
			}
		}()

		// Keep connection open until client disconnects
		<-notify
		clientsMu.Lock()
		delete(sseClients, client)
		clientsMu.Unlock()
	})

	go func() {
		for payload := range eventBroadcast {
			clientsMu.Lock()
			for client := range sseClients {
				select {
				case client <- payload:
				default:
					// Drop slow client
					delete(sseClients, client)
					close(client)
				}
			}
			clientsMu.Unlock()
		}
	}()

	log.Println("go-dashboard listening on :3847")
	log.Fatal(http.ListenAndServe(":3847", nil))
}
