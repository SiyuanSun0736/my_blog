package blog

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	defaultMediaDir             = "./uploads"
	defaultMediaURLPath         = "/media"
	defaultMaxUploadBytes int64 = 8 * 1024 * 1024
	multipartSlackBytes   int64 = 512 * 1024
)

var allowedImageContentTypes = map[string]string{
	"image/gif":  ".gif",
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

type ImageUploadResponse struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Bytes       int    `json:"bytes"`
	Cached      bool   `json:"cached"`
}

func normalizeMediaURLPath(value string) string {
	normalizedValue := strings.TrimSpace(value)
	if normalizedValue == "" {
		return defaultMediaURLPath
	}

	if !strings.HasPrefix(normalizedValue, "/") {
		normalizedValue = "/" + normalizedValue
	}

	normalizedValue = strings.TrimRight(path.Clean(normalizedValue), "/")
	if normalizedValue == "" || normalizedValue == "." || normalizedValue == "/" {
		return defaultMediaURLPath
	}

	return normalizedValue
}

func (h *Handler) uploadImage(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxUploadBytes+multipartSlackBytes)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		switch {
		case errors.Is(err, http.ErrMissingFile):
			c.JSON(http.StatusBadRequest, gin.H{"message": "image file is required"})
		case isUploadTooLarge(err):
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "image file is too large"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid multipart upload"})
		}
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "failed to read image file"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, h.maxUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "failed to read image file"})
		return
	}

	if int64(len(data)) > h.maxUploadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "image file is too large"})
		return
	}

	if len(data) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "image file is empty"})
		return
	}

	sniffLength := len(data)
	if sniffLength > 512 {
		sniffLength = 512
	}

	contentType := http.DetectContentType(data[:sniffLength])
	fileExtension, allowed := allowedImageContentTypes[contentType]
	if !allowed {
		c.JSON(http.StatusBadRequest, gin.H{"message": "only gif, jpg, png and webp images are supported"})
		return
	}

	digest := sha256.Sum256(data)
	digestHex := hex.EncodeToString(digest[:])
	if cachedPath, found, err := h.uploadCache.Get(c.Request.Context(), digestHex); err == nil && found {
		if cachedFilePath, ok := h.mediaFilePath(cachedPath); ok {
			if _, statErr := os.Stat(cachedFilePath); statErr == nil {
				c.JSON(http.StatusOK, ImageUploadResponse{
					URL:         cachedPath,
					Path:        cachedPath,
					ContentType: contentType,
					Bytes:       len(data),
					Cached:      true,
				})
				return
			}
		}
	}

	relativeDirectory := time.Now().UTC().Format("2006/01")
	relativePath := path.Join(relativeDirectory, digestHex+fileExtension)
	storageDirectory := filepath.Join(h.mediaDir, filepath.FromSlash(relativeDirectory))
	storagePath := filepath.Join(h.mediaDir, filepath.FromSlash(relativePath))
	publicPath := path.Join(h.mediaURLPath, relativePath)

	if err := os.MkdirAll(storageDirectory, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to prepare media directory"})
		return
	}

	if _, err := os.Stat(storagePath); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to prepare media file"})
			return
		}

		if err := os.WriteFile(storagePath, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to store image file"})
			return
		}
	}

	_ = h.uploadCache.Set(c.Request.Context(), digestHex, publicPath)

	c.JSON(http.StatusCreated, ImageUploadResponse{
		URL:         publicPath,
		Path:        publicPath,
		ContentType: contentType,
		Bytes:       len(data),
		Cached:      false,
	})
}

func (h *Handler) mediaFilePath(publicPath string) (string, bool) {
	normalizedPublicPath := path.Clean("/" + strings.TrimSpace(publicPath))
	mediaPrefix := normalizeMediaURLPath(h.mediaURLPath)
	if normalizedPublicPath == mediaPrefix || !strings.HasPrefix(normalizedPublicPath, mediaPrefix+"/") {
		return "", false
	}

	relativePath := strings.TrimPrefix(normalizedPublicPath, mediaPrefix+"/")
	if relativePath == "" {
		return "", false
	}

	return filepath.Join(h.mediaDir, filepath.FromSlash(relativePath)), true
}

func isUploadTooLarge(err error) bool {
	if err == nil {
		return false
	}

	errText := err.Error()
	return strings.Contains(errText, "request body too large") || strings.Contains(errText, "message too large")
}
