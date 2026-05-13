package blog

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestMediaCleanerCleanupUnusedMediaDeletesOrphansAndCacheKeys(t *testing.T) {
	t.Parallel()

	mediaDir := t.TempDir()
	referencedDigest := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	orphanDigest := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	referencedPath := createTestMediaFile(t, mediaDir, filepath.Join("2026", "05", referencedDigest+".png"))
	orphanPath := createTestMediaFile(t, mediaDir, filepath.Join("2026", "05", orphanDigest+".webp"))
	cache := &fakeUploadCache{
		existingDigests: map[string]struct{}{
			referencedDigest: {},
			orphanDigest:     {},
		},
	}

	cleaner := NewMediaCleaner(staticPostBodySource{
		bodies: []string{
			"![cover](/media/2026/05/" + referencedDigest + ".png?size=full#hero)",
		},
	}, MediaCleanerOptions{
		MediaDir:     mediaDir,
		MediaURLPath: "/media",
		UploadCache:  cache,
	})
	report, err := cleaner.CleanupUnusedMedia(context.Background())
	if err != nil {
		t.Fatalf("expected cleanup to succeed, got %v", err)
	}

	if report.ReferencedPaths != 1 {
		t.Fatalf("expected 1 referenced path, got %d", report.ReferencedPaths)
	}

	if report.ScannedFiles != 2 {
		t.Fatalf("expected 2 scanned files, got %d", report.ScannedFiles)
	}

	if report.DeletedFiles != 1 {
		t.Fatalf("expected 1 deleted file, got %d", report.DeletedFiles)
	}

	if report.DeletedCacheEntries != 1 {
		t.Fatalf("expected 1 deleted cache entry, got %d", report.DeletedCacheEntries)
	}

	if _, err := os.Stat(referencedPath); err != nil {
		t.Fatalf("expected referenced media to remain, stat failed: %v", err)
	}

	if _, err := os.Stat(orphanPath); !os.IsNotExist(err) {
		t.Fatalf("expected orphan media to be removed, stat err = %v", err)
	}

	deletedDigests := cache.deletedDigests()
	if len(deletedDigests) != 1 || deletedDigests[0] != orphanDigest {
		t.Fatalf("expected orphan digest to be removed from cache, got %v", deletedDigests)
	}
}

func TestExtractMediaReferencesNormalizesMarkdownAndHTMLPaths(t *testing.T) {
	t.Parallel()

	references := extractMediaReferences(`
		![diagram](/media/2026/05/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)
		<img src="/media/2026/05/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp?download=1#hero">
		plain /media/2026/05/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.svg.
	`, "/media")

	paths := make([]string, 0, len(references))
	for publicPath := range references {
		paths = append(paths, publicPath)
	}
	sort.Strings(paths)

	expected := []string{
		"/media/2026/05/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
		"/media/2026/05/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
		"/media/2026/05/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.svg",
	}

	if len(paths) != len(expected) {
		t.Fatalf("expected %d extracted paths, got %d (%v)", len(expected), len(paths), paths)
	}

	for index, path := range expected {
		if paths[index] != path {
			t.Fatalf("expected path %q at index %d, got %q", path, index, paths[index])
		}
	}
}

type staticPostBodySource struct {
	bodies []string
}

func (s staticPostBodySource) ListPostBodies(context.Context) ([]string, error) {
	return s.bodies, nil
}

type fakeUploadCache struct {
	existingDigests map[string]struct{}
	deleted         []string
}

func (f *fakeUploadCache) Get(context.Context, string) (string, bool, error) {
	return "", false, nil
}

func (f *fakeUploadCache) Set(context.Context, string, string) error {
	return nil
}

func (f *fakeUploadCache) Delete(_ context.Context, digest string) (bool, error) {
	if _, exists := f.existingDigests[digest]; !exists {
		return false, nil
	}

	delete(f.existingDigests, digest)
	f.deleted = append(f.deleted, digest)
	return true, nil
}

func (f *fakeUploadCache) deletedDigests() []string {
	deleted := append([]string(nil), f.deleted...)
	sort.Strings(deleted)
	return deleted
}

func createTestMediaFile(t *testing.T, mediaDir string, relativePath string) string {
	t.Helper()

	absolutePath := filepath.Join(mediaDir, relativePath)
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		t.Fatalf("failed to create media directory: %v", err)
	}

	if err := os.WriteFile(absolutePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create media file: %v", err)
	}

	return absolutePath
}
