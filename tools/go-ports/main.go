package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func main() {
	port := os.Getenv("GO_PORTS_PORT")
	if port == "" {
		port = "3851"
	}

	mux := http.NewServeMux()
	cors := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "go-ports",
		})
	})

	mux.HandleFunc("/check/", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) < 4 {
			http.Error(w, "usage: /check/<port>", http.StatusBadRequest)
			return
		}
		p, err := strconv.Atoi(parts[3])
		if err != nil {
			http.Error(w, "invalid port", http.StatusBadRequest)
			return
		}
		isOpen := isPortInUse(p)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"port":     p,
			"in_use":   isOpen,
			"protocol": "tcp",
		})
	})

	mux.HandleFunc("/scan", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		portsParam := r.URL.Query().Get("ports")
		if portsParam == "" {
			http.Error(w, "?ports=8000,5173,3847 required", http.StatusBadRequest)
			return
		}
		parts := strings.Split(portsParam, ",")
		results := make([]map[string]interface{}, 0, len(parts))
		for _, part := range parts {
			p, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				continue
			}
			results = append(results, map[string]interface{}{
				"port":   p,
				"in_use": isPortInUse(p),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ports":  results,
			"total":  len(results),
		})
	})

	fmt.Printf("go-ports listening on :%s\n", port)
	http.ListenAndServe(":"+port, mux)
}

func isPortInUse(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return true
	}
	ln.Close()
	return false
}
