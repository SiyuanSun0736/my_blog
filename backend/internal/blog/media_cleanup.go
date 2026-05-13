package blog

import (
	"context"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
)

const mediaReferenceTrailingRunes = ".,;:!?)]}>\"'"

type PostBodySource interface {
	ListPostBodies(ctx context.Context) ([]string, error)
}

type MediaCleaner struct {
	posts        PostBodySource
	mediaDir     string
	mediaURLPath string
	uploadCache  UploadCache
}

type MediaCleanerOptions struct {
	MediaDir     string
	MediaURLPath string
	UploadCache  UploadCache
}

type MediaCleanupReport struct {
	ReferencedPaths     int
	ScannedFiles        int
	DeletedFiles        int
	DeletedCacheEntries int
}

func NewMediaCleaner(posts PostBodySource, options MediaCleanerOptions) *MediaCleaner {
	mediaDir := strings.TrimSpace(options.MediaDir)
	if mediaDir == "" {
		mediaDir = defaultMediaDir
	}

	uploadCache := options.UploadCache
	if uploadCache == nil {
		uploadCache = noopUploadCache{}
	}

	return &MediaCleaner{
		posts:        posts,
		mediaDir:     mediaDir,
		mediaURLPath: normalizeMediaURLPath(options.MediaURLPath),
		uploadCache:  uploadCache,
	}
}

func (c *MediaCleaner) CleanupUnusedMedia(ctx context.Context) (MediaCleanupReport, error) {
	var report MediaCleanupReport

	if c.posts == nil {
		return report, errors.New("post body source is required")
	}

	referencedPaths, err := c.referencedMediaPaths(ctx)
	if err != nil {
		return report, err
	}
	if referencedPaths != nil {
		report.ReferencedPaths = len(referencedPaths)
	}

	if _, err := os.Stat(c.mediaDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return report, nil
		}

		return report, err
	}

	err = filepath.WalkDir(c.mediaDir, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		if entry.IsDir() {
			return nil
		}

		report.ScannedFiles++

		relativePath, err := filepath.Rel(c.mediaDir, filePath)
		if err != nil {
			return err
		}

		publicPath := c.publicPathForRelativePath(relativePath)
		if _, referenced := referencedPaths[publicPath]; referenced {
			return nil
		}

		if err := os.Remove(filePath); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}

			return err
		}

		report.DeletedFiles++

		if digest, ok := mediaDigestFromRelativePath(relativePath); ok {
			deleted, err := c.uploadCache.Delete(ctx, digest)
			if err != nil {
				return err
			}

			if deleted {
				report.DeletedCacheEntries++
			}
		}

		return nil
	})
	if err != nil {
		return report, err
	}

	return report, nil
}

func (c *MediaCleaner) referencedMediaPaths(ctx context.Context) (map[string]struct{}, error) {
	bodies, err := c.posts.ListPostBodies(ctx)
	if err != nil {
		return nil, err
	}

	referencedPaths := make(map[string]struct{})
	for _, body := range bodies {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		for publicPath := range extractMediaReferences(body, c.mediaURLPath) {
			referencedPaths[publicPath] = struct{}{}
		}
	}

	return referencedPaths, nil
}

func (c *MediaCleaner) publicPathForRelativePath(relativePath string) string {
	normalizedRelativePath := strings.TrimLeft(pathpkg.Clean(filepath.ToSlash(relativePath)), "/")
	return pathpkg.Join(c.mediaURLPath, normalizedRelativePath)
}

func extractMediaReferences(markdown string, mediaURLPath string) map[string]struct{} {
	if strings.TrimSpace(markdown) == "" {
		return nil
	}

	mediaPrefix := normalizeMediaURLPath(mediaURLPath)
	pattern := regexp.MustCompile(regexp.QuoteMeta(mediaPrefix) + `/[^\s"'<>\)\]\}]+`)
	matches := pattern.FindAllString(markdown, -1)
	if len(matches) == 0 {
		return nil
	}

	referencedPaths := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		normalizedPath := normalizeReferencedMediaPath(match, mediaPrefix)
		if normalizedPath == "" {
			continue
		}

		referencedPaths[normalizedPath] = struct{}{}
	}

	return referencedPaths
}

func normalizeReferencedMediaPath(rawPath string, mediaPrefix string) string {
	candidate := strings.TrimSpace(rawPath)
	if candidate == "" {
		return ""
	}

	if separatorIndex := strings.IndexAny(candidate, "?#"); separatorIndex >= 0 {
		candidate = candidate[:separatorIndex]
	}

	candidate = strings.TrimRight(candidate, mediaReferenceTrailingRunes)
	normalizedPath := pathpkg.Clean("/" + strings.TrimSpace(candidate))
	if normalizedPath == mediaPrefix || !strings.HasPrefix(normalizedPath, mediaPrefix+"/") {
		return ""
	}

	return normalizedPath
}

func mediaDigestFromRelativePath(relativePath string) (string, bool) {
	fileName := filepath.Base(relativePath)
	digestHex := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	if len(digestHex) != 64 {
		return "", false
	}

	decodedDigest, err := hex.DecodeString(digestHex)
	if err != nil || len(decodedDigest) != 32 {
		return "", false
	}

	return strings.ToLower(digestHex), true
}
