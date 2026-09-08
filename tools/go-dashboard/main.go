package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

func main() {
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "go-dashboard",
		})
	})

	http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

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
