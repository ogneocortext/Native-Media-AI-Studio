package main

// Port 3848 listener — the go-media role: an FFmpeg job runner.
//
// POST /process accepts {input, output, operation, start, duration} and runs
// ffmpeg asynchronously (max 4 concurrent jobs), reporting progress on the
// /events SSE stream as job.progress events. Job state lives in memory only —
// completed jobs are removed from the store.
//
// Wiring status: services/go_media_client.py can call this, but no backend
// code path invokes it yet — FFmpeg work runs in-process via ffmpeg_tools.py.
// The endpoints are reserved capacity; treat them as the offload seam.
//
// Operations: thumbnail, normalize (loudnorm I=-16), concat (segment cut),
// extract_audio (PCM 16-bit 44.1kHz stereo WAV).
// Routes: GET /api/health, GET /version, POST /process, GET /jobs,
// GET|DELETE /jobs/{id}, GET /events.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	sse "github.com/r3labs/sse/v2"
)

const (
	mediaService = "go-media"
	mediaVersion = "0.3"
)

var (
	mediaBus     = sse.New()
	mediaJobs    = make(map[string]*MediaJob)
	mediaCancels = make(map[string]context.CancelFunc)
	mediaMu      sync.Mutex
	mediaSlots   = make(chan struct{}, 4)
)

// MediaJob is one ffmpeg invocation.
type MediaJob struct {
	JobID     string `json:"job_id,omitempty"`
	Input     string `json:"input"`
	Output    string `json:"output"`
	Operation string `json:"operation"` // "thumbnail", "concat", "normalize", "extract_audio"
	Start     string `json:"start,omitempty"`
	Duration  string `json:"duration,omitempty"`
}

func lookFFmpeg() (string, error) {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p, nil
	}
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "ffmpeg", "bin", "ffmpeg.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Git", "usr", "bin", "ffmpeg.exe"),
		`C:\ffmpeg\bin\ffmpeg.exe`,
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("ffmpeg not found on PATH")
}

func ffmpegPath() string {
	p, err := lookFFmpeg()
	if err != nil {
		logger.Warn("ffmpeg not found", "error", err)
		return "missing"
	}
	return p
}

func emitMediaProgress(jobID, stage string, pct float64) {
	mediaBus.Publish("jobs", &sse.Event{
		Event: []byte("job.progress"),
		Data:  []byte(fmt.Sprintf(`{"job_id":"%s","stage":"%s","progress":%.2f}`, jobID, stage, pct)),
	})
}

func runMediaJob(ctx context.Context, job MediaJob) error {
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
	case "extract_audio":
		args = []string{
			"-i", job.Input,
			"-vn",
			"-acodec", "pcm_s16le",
			"-ar", "44100",
			"-ac", "2",
			job.Output,
		}
	default:
		return fmt.Errorf("unknown operation: %s", job.Operation)
	}

	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func mediaMux() *http.ServeMux {
	mediaBus.CreateStream("jobs")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler(mediaService, mediaVersion, map[string]any{
		"ffmpeg": ffmpegPath(),
	}))
	mux.HandleFunc("GET /version", versionHandler(mediaService, mediaVersion))

	mux.HandleFunc("POST /process", cors(func(w http.ResponseWriter, r *http.Request) {
		var job MediaJob
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&job); err != nil {
			logger.Warn("invalid process payload", "error", err)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if job.Input == "" || job.Output == "" {
			writeErr(w, http.StatusBadRequest, "input and output required")
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

		jobID := newJobID()
		job.JobID = jobID
		ctx, cancel := context.WithCancel(context.Background())

		mediaMu.Lock()
		mediaJobs[jobID] = &job
		mediaCancels[jobID] = cancel
		mediaMu.Unlock()

		emitMediaProgress(jobID, "started", 0.0)
		logger.Info("media job started", "jobID", jobID, "operation", job.Operation)

		select {
		case mediaSlots <- struct{}{}:
			go func() {
				defer func() { <-mediaSlots }()
				err := runMediaJob(ctx, job)
				cancel()
				mediaMu.Lock()
				delete(mediaJobs, jobID)
				delete(mediaCancels, jobID)
				mediaMu.Unlock()
				if err != nil {
					emitMediaProgress(jobID, "error", 0.0)
					logger.Error("media job failed", "jobID", jobID, "error", err)
					return
				}
				emitMediaProgress(jobID, "done", 1.0)
				logger.Info("media job completed", "jobID", jobID)
			}()
		default:
			mediaMu.Lock()
			delete(mediaJobs, jobID)
			delete(mediaCancels, jobID)
			mediaMu.Unlock()
			writeErr(w, http.StatusServiceUnavailable, "media job capacity reached")
			return
		}

		writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted", "job_id": jobID})
	}))

	mux.HandleFunc("GET /jobs", cors(func(w http.ResponseWriter, r *http.Request) {
		mediaMu.Lock()
		list := make([]*MediaJob, 0, len(mediaJobs))
		for _, j := range mediaJobs {
			list = append(list, j)
		}
		mediaMu.Unlock()
		writeJSON(w, http.StatusOK, list)
	}))

	mux.HandleFunc("GET /jobs/{id}", cors(func(w http.ResponseWriter, r *http.Request) {
		mediaMu.Lock()
		job, ok := mediaJobs[r.PathValue("id")]
		mediaMu.Unlock()
		if !ok {
			writeErr(w, http.StatusNotFound, "job not found")
			return
		}
		writeJSON(w, http.StatusOK, job)
	}))

	mux.HandleFunc("DELETE /jobs/{id}", cors(func(w http.ResponseWriter, r *http.Request) {
		mediaMu.Lock()
		cancel, ok := mediaCancels[r.PathValue("id")]
		mediaMu.Unlock()
		if !ok {
			writeErr(w, http.StatusNotFound, "job not found")
			return
		}
		cancel()
		w.WriteHeader(http.StatusAccepted)
	}))

	mux.HandleFunc("GET /events", cors(func(w http.ResponseWriter, r *http.Request) {
		mediaBus.ServeHTTP(w, r)
	}))

	return mux
}

// mediaHeartbeat mirrors the dashboard keep-alive on the jobs stream.
func mediaHeartbeat() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		mediaBus.Publish("jobs", &sse.Event{
			Event:   []byte("heartbeat"),
			Data:    []byte(`{"alive":true}`),
			Comment: []byte("keep-alive"),
		})
	}
}
