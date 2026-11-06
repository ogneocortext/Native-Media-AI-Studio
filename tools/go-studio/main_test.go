package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNewJobIDIsUnique(t *testing.T) {
	ids := make(map[string]struct{}, 256)
	for i := 0; i < 256; i++ {
		id := newJobID()
		if id == "" {
			t.Fatal("newJobID returned an empty ID")
		}
		if _, exists := ids[id]; exists {
			t.Fatalf("newJobID returned a duplicate ID: %q", id)
		}
		ids[id] = struct{}{}
	}
}

func TestMediaJobOperationValidation(t *testing.T) {
	valid := map[string]bool{
		"thumbnail":     true,
		"concat":        true,
		"normalize":     true,
		"extract_audio": true,
	}
	for operation := range valid {
		if !valid[operation] {
			t.Fatalf("unexpected valid operation: %q", operation)
		}
	}
	if valid["unknown"] {
		t.Fatal("unknown operation unexpectedly accepted")
	}
}

func TestSidecarPathRejectsTraversal(t *testing.T) {
	workerOutDir = t.TempDir()
	for _, name := range []string{"../escape", `..\\escape`, "nested/file", "", "."} {
		if _, err := sidecarPath(name); err == nil {
			t.Errorf("expected rejection for filename %q", name)
		}
	}
}

func TestPersistWorkerJobsRoundTrip(t *testing.T) {
	workerOutDir = t.TempDir()
	workerJobsFile = filepath.Join(workerOutDir, "jobs.json")
	workerJobs = map[string]*WorkerJob{"job-1": {ID: "job-1", Type: "test", Status: "pending"}}
	if err := persistWorkerJobs(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(workerJobsFile)
	if err != nil {
		t.Fatal(err)
	}
	var loaded map[string]*WorkerJob
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatal(err)
	}
	if loaded["job-1"].Type != "test" {
		t.Fatalf("unexpected persisted job: %#v", loaded["job-1"])
	}
}
