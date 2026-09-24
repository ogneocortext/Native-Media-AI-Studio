package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSidecarPathRejectsTraversal(t *testing.T) {
	outputDir = t.TempDir()
	for _, name := range []string{"../escape", `..\\escape`, "nested/file", "", "."} {
		if _, err := sidecarPath(name); err == nil {
			t.Errorf("expected rejection for filename %q", name)
		}
	}
}

func TestPersistJobsRoundTrip(t *testing.T) {
	outputDir = t.TempDir()
	jobsFile = filepath.Join(outputDir, "jobs.json")
	jobs = map[string]*Job{"job-1": {ID: "job-1", Type: "test", Status: "pending"}}
	if err := persistJobs(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(jobsFile)
	if err != nil {
		t.Fatal(err)
	}
	var loaded map[string]*Job
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatal(err)
	}
	if loaded["job-1"].Type != "test" {
		t.Fatalf("unexpected persisted job: %#v", loaded["job-1"])
	}
}
