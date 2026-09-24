package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
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
		portStr := strings.TrimPrefix(r.URL.Path, "/check/")
		p, err := strconv.Atoi(strings.TrimSpace(portStr))
		if err != nil || p < 1 || p > 65535 {
			http.Error(w, "invalid port", http.StatusBadRequest)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "GET only", http.StatusMethodNotAllowed)
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
		if r.Method != http.MethodGet {
			http.Error(w, "GET only", http.StatusMethodNotAllowed)
			return
		}
		portsParam := r.URL.Query().Get("ports")
		if portsParam == "" {
			http.Error(w, "?ports=8000,5173,3847 required", http.StatusBadRequest)
			return
		}
		parts := strings.Split(portsParam, ",")
		if len(parts) > 100 {
			http.Error(w, "at most 100 ports may be scanned", http.StatusBadRequest)
			return
		}
		ports := make([]int, 0, len(parts))
		seen := make(map[int]struct{}, len(parts))
		for _, part := range parts {
			p, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil || p < 1 || p > 65535 {
				http.Error(w, "ports must be integers between 1 and 65535", http.StatusBadRequest)
				return
			}
			if _, exists := seen[p]; !exists {
				seen[p] = struct{}{}
				ports = append(ports, p)
			}
		}
		results := make([]map[string]interface{}, len(ports))
		var wg sync.WaitGroup
		for i, p := range ports {
			wg.Add(1)
			go func(index, port int) {
				defer wg.Done()
				results[index] = map[string]interface{}{"port": port, "in_use": isPortInUse(port)}
			}(i, p)
		}
		wg.Wait()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ports": results,
			"total": len(results),
		})
	})

	fmt.Printf("go-ports listening on :%s\n", port)
	server := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	shutdown, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdown.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func isPortInUse(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	conn, err := net.DialTimeout("tcp", addr, 1*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
