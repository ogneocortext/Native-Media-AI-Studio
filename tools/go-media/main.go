package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// MediaJob represents a media processing job.
type MediaJob struct {
	Input     string
	Output    string
	Operation string // "thumbnail", "concat", "normalize"
	Start     string
	Duration  string
}

func run(job MediaJob) error {
	ffmpeg, err := lookFFmpeg()
	if err != nil {
		return err
	}

	var args []string
	switch job.Operation {
	case "thumbnail":
		args = []string{
			"-ss", job.Start,
			"-i", job.Input,
			"-vframes", "1",
			"-q:v", "2",
			job.Output,
		}
	case "normalize":
		args = []string{
			"-i", job.Input,
			"-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
			"-ar", "48000",
			"-c:v", "copy",
			job.Output,
		}
	case "concat":
		args = []string{
			"-ss", job.Start,
			"-i", job.Input,
			"-t", job.Duration,
			"-c", "copy",
			job.Output,
		}
	default:
		return fmt.Errorf("unknown operation: %s", job.Operation)
	}

	cmd := exec.Command(ffmpeg, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func lookFFmpeg() (string, error) {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p, nil
	}
	// Common Windows install paths
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "ffmpeg", "bin", "ffmpeg.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Git", "usr", "bin", "ffmpeg.exe"),
		"C:\\ffmpeg\\bin\\ffmpeg.exe",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("ffmpeg not found on PATH")
}

func mustLookFFmpeg() string {
	p, err := lookFFmpeg()
	if err != nil {
		return "missing"
	}
	return p
}

// JSON status output for programmatic callers.
func init() {
	if len(os.Args) > 1 && os.Args[1] == "--json" {
		status := map[string]string{
			"status":  "ok",
			"ffmpeg":  mustLookFFmpeg(),
			"version": "0.2",
		}
		b, _ := json.MarshalIndent(status, "", "  ")
		fmt.Println(string(b))
		os.Exit(0)
	}
}

func main() {
	serverMode := flag.Bool("server", false, "Run as HTTP server on :3848")
	port := flag.String("port", "3848", "HTTP server port (used with --server)")
	op := flag.String("op", "thumbnail", "Operation: thumbnail, concat, normalize")
	in := flag.String("in", "", "Input file path")
	out := flag.String("out", "", "Output file path")
	start := flag.String("start", "00:00:01.000", "Start time for thumbnail")
	duration := flag.Duration("duration", 5*time.Second, "Duration for concat/normalize")
	flag.Parse()

	if *serverMode {
		runMediaServer(*port)
		return
	}

	if *in == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "usage: go-media -op <op> -in <input> -out <output> [--start --duration]")
		fmt.Fprintln(os.Stderr, "   or: go-media --server [--port 3848]")
		os.Exit(2)
	}

	job := MediaJob{
		Input:     *in,
		Output:    *out,
		Operation: *op,
		Start:     *start,
		Duration:  fmt.Sprintf("%.3f", duration.Seconds()),
	}

	if err := run(job); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func runMediaServer(port string) {
	r := http.NewServeMux()

	cors := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "go-media",
			"ffmpeg":  mustLookFFmpeg(),
		})
	})

	r.HandleFunc("/process", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == "OPTIONS" {
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var job MediaJob
		if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if job.Input == "" || job.Output == "" {
			http.Error(w, "input and output required", http.StatusBadRequest)
			return
		}
		if job.Operation == "" {
			job.Operation = "thumbnail"
		}
		if job.Start == "" {
			job.Start = "00:00:01.000"
		}
		if job.Duration == "" {
			job.Duration = "00:00:05.000"
		}
		if err := run(job); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "output": job.Output})
	})

	log.Printf("go-media listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
