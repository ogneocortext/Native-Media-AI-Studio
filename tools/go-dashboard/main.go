package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

func corsMiddleware(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
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

		for {
			data := map[string]interface{}{
				"timestamp": time.Now().Format(time.RFC3339),
				"service":   "go-dashboard",
				"status":    "running",
			}
			json.NewEncoder(w).Encode(data)
			flusher.Flush()
			time.Sleep(2 * time.Second)
		}
	})

	log.Println("go-dashboard listening on :3847")
	log.Fatal(http.ListenAndServe(":3847", nil))
}
