package main

import (
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
