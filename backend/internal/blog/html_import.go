package blog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	stdhtml "html"
	"io"
	"mime/multipart"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"
	"time"

	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var errHTMLImportTooLarge = fmt.Errorf("html import source exceeds %d bytes", maxHTMLImportBytes)

const (
	htmlImportPreviewRoute       = "/api/imports/html/preview"
	htmlImportSummaryFallback    = "已导入原始 HTML 页面，请通过正文链接查看完整内容。"
	htmlImportPreviewNotice      = "原始 HTML 已作为独立页面保存，点击下方链接查看完整内容。"
	htmlImportPreviewContentType = "text/html; charset=utf-8"
	htmlImportPreviewCSP         = "sandbox allow-forms allow-modals; default-src https: http: data: blob:; img-src * data: blob:; media-src * data: blob:; font-src * data: blob:; style-src 'unsafe-inline' https: http: data:; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https: http:;"
)

func importHTMLDocumentFromFile(fileHeader *multipart.FileHeader, mediaDir string, mediaURLPath string, uploadCache UploadCache) (HTMLImportResult, error) {
	if fileHeader == nil {
		return HTMLImportResult{}, fmt.Errorf("html file is required")
	}

	if !isHTMLDocumentFileName(fileHeader.Filename) {
		return HTMLImportResult{}, fmt.Errorf("only .html or .htm files are supported")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return HTMLImportResult{}, fmt.Errorf("open html file: %w", err)
	}
	defer file.Close()

	contents, err := io.ReadAll(io.LimitReader(file, maxHTMLImportBytes+1))
	if err != nil {
		return HTMLImportResult{}, fmt.Errorf("read html file: %w", err)
	}

	if len(contents) > maxHTMLImportBytes {
		return HTMLImportResult{}, errHTMLImportTooLarge
	}

	return importHTMLDocumentContents(fileHeader.Filename, contents, mediaDir, mediaURLPath, uploadCache)
}

func importHTMLDocumentContents(fileName string, contents []byte, mediaDir string, mediaURLPath string, uploadCache UploadCache) (HTMLImportResult, error) {
	if !isHTMLDocumentFileName(fileName) {
		return HTMLImportResult{}, fmt.Errorf("only .html or .htm files are supported")
	}

	if len(bytes.TrimSpace(contents)) == 0 {
		return HTMLImportResult{}, ErrInvalidPost
	}

	imported, err := parseHTMLImportMetadata(fileName, string(contents))
	if err != nil {
		return HTMLImportResult{}, err
	}

	publicPath, err := storeImportedHTMLSource(fileName, contents, mediaDir, mediaURLPath, uploadCache)
	if err != nil {
		return HTMLImportResult{}, err
	}

	imported.BodyFormat = BodyFormatHTML
	imported.Body = buildHTMLImportPreviewBody(publicPath, imported.Title)
	if strings.TrimSpace(imported.Summary) == "" {
		imported.Summary = htmlImportSummaryFallback
	}

	return imported, nil
}

func parseHTMLImportMetadata(fileName string, rawHTML string) (HTMLImportResult, error) {
	document, err := htmlnode.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return HTMLImportResult{}, err
	}

	root := findHTMLImportRoot(document)
	title := firstTextForTag(root, atom.H1)
	if title == "" {
		title = documentTitle(document)
	}
	if title == "" {
		title = stripHTMLDocumentExtension(fileName)
	}

	body := sanitizeBodyContent(renderNodeInnerHTML(root), BodyFormatHTML)
	summary := extractMetaContent(document, "name", "description")
	if summary == "" && body != "" {
		summary = summarizeBody(body, BodyFormatHTML)
	}

	return HTMLImportResult{
		Title:   title,
		Slug:    normalizeSlug(stripHTMLDocumentExtension(fileName), title),
		Summary: summary,
		Tags:    splitKeywords(extractMetaContent(document, "name", "keywords")),
		Author:  extractMetaContent(document, "name", "author"),
		PublishedAt: normalizeImportedPublishedAt(
			firstNonEmpty(
				extractMetaContent(document, "property", "article:published_time"),
				extractMetaContent(document, "name", "article:published_time"),
				extractMetaContent(document, "name", "pubdate"),
				extractMetaContent(document, "name", "date"),
			),
		),
	}, nil
}

func storeImportedHTMLSource(fileName string, contents []byte, mediaDir string, mediaURLPath string, uploadCache UploadCache) (string, error) {
	trimmedMediaDir := strings.TrimSpace(mediaDir)
	if trimmedMediaDir == "" {
		trimmedMediaDir = defaultMediaDir
	}

	normalizedMediaURLPath := normalizeMediaURLPath(mediaURLPath)
	cache := uploadCache
	if cache == nil {
		cache = noopUploadCache{}
	}

	digest := sha256.Sum256(contents)
	digestHex := hex.EncodeToString(digest[:])
	if cachedPath, found, err := cache.Get(context.Background(), digestHex); err == nil && found {
		normalizedCachedPath := normalizeReferencedMediaPath(cachedPath, normalizedMediaURLPath)
		if normalizedCachedPath != "" {
			relativeCachedPath := strings.TrimPrefix(normalizedCachedPath, normalizedMediaURLPath+"/")
			cachedFilePath := filepath.Join(trimmedMediaDir, filepath.FromSlash(relativeCachedPath))
			if _, statErr := os.Stat(cachedFilePath); statErr == nil {
				return normalizedCachedPath, nil
			}
		}
	}

	relativeDirectory := pathpkg.Join("imports", time.Now().UTC().Format("2006/01"))
	relativePath := pathpkg.Join(relativeDirectory, digestHex+importedHTMLFileExtension(fileName))
	storageDirectory := filepath.Join(trimmedMediaDir, filepath.FromSlash(relativeDirectory))
	storagePath := filepath.Join(trimmedMediaDir, filepath.FromSlash(relativePath))
	publicPath := pathpkg.Join(normalizedMediaURLPath, relativePath)

	if err := os.MkdirAll(storageDirectory, 0o755); err != nil {
		return "", err
	}

	if _, err := os.Stat(storagePath); err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}

		if err := os.WriteFile(storagePath, contents, 0o644); err != nil {
			return "", err
		}
	}

	_ = cache.Set(context.Background(), digestHex, publicPath)
	return publicPath, nil
}

func importedHTMLFileExtension(fileName string) string {
	fileExtension := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	switch fileExtension {
	case ".htm", ".html", ".xhtml":
		return fileExtension
	default:
		return ".html"
	}
}

func buildHTMLImportPreviewBody(publicPath string, title string) string {
	previewPath := htmlImportPreviewRoute + "?src=" + strings.TrimSpace(publicPath)
	linkLabel := "打开导入的 HTML 页面"
	if trimmedTitle := strings.TrimSpace(title); trimmedTitle != "" {
		linkLabel = "打开导入的 HTML 页面：" + trimmedTitle
	}

	return fmt.Sprintf(
		"<article><p>%s</p><p><a href=\"%s\">%s</a></p></article>",
		stdhtml.EscapeString(htmlImportPreviewNotice),
		stdhtml.EscapeString(previewPath),
		stdhtml.EscapeString(linkLabel),
	)
}
