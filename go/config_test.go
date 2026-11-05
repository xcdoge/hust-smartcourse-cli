package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitPathsCreatesStateDirectories(t *testing.T) {
	chdirTempDir(t)

	if err := initPaths(); err != nil {
		t.Fatalf("initPaths() error = %v", err)
	}

	for _, sub := range []string{"auth", "course", "quiz", "logs"} {
		path := filepath.Join(stateDir, sub)
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("state directory %s is missing: %v", sub, err)
		}
		if !info.IsDir() {
			t.Fatalf("state path %s is not a directory", sub)
		}
	}
}

func TestLoginQRCodeCanBeWrittenOnFreshInstall(t *testing.T) {
	chdirTempDir(t)

	if err := initPaths(); err != nil {
		t.Fatalf("initPaths() error = %v", err)
	}

	qrPath := statePath("login-qr.png")
	if err := os.WriteFile(qrPath, []byte("qr"), 0o644); err != nil {
		t.Fatalf("writing QR code to %s: %v", qrPath, err)
	}
	if _, err := os.Stat(qrPath); err != nil {
		t.Fatalf("QR code was not created at %s: %v", qrPath, err)
	}
}

func TestInitPathsMigratesFlatStateFiles(t *testing.T) {
	chdirTempDir(t)
	legacyStateDir := "state"
	if err := os.MkdirAll(legacyStateDir, 0o755); err != nil {
		t.Fatalf("creating legacy state directory: %v", err)
	}
	legacyCookies := filepath.Join(legacyStateDir, "cookies.json")
	contents := []byte(`{"cookies":[{"name":"session","value":"test"}]}`)
	if err := os.WriteFile(legacyCookies, contents, 0o644); err != nil {
		t.Fatalf("writing legacy cookie file: %v", err)
	}

	if err := initPaths(); err != nil {
		t.Fatalf("initPaths() error = %v", err)
	}

	migratedCookies := statePath("cookies.json")
	got, err := os.ReadFile(migratedCookies)
	if err != nil {
		t.Fatalf("reading migrated cookie file: %v", err)
	}
	if string(got) != string(contents) {
		t.Fatalf("migrated cookie contents = %q, want %q", got, contents)
	}
	if _, err := os.Stat(legacyCookies); !os.IsNotExist(err) {
		t.Fatalf("legacy cookie file still exists, stat error = %v", err)
	}
}

func chdirTempDir(t *testing.T) {
	t.Helper()
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getting current directory: %v", err)
	}
	temporaryDir := t.TempDir()
	if err := os.Chdir(temporaryDir); err != nil {
		t.Fatalf("changing to temporary directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalDir); err != nil {
			t.Errorf("restoring current directory: %v", err)
		}
	})
}
