package blog

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const sampleImportedHTMLDocument = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>综合级 HTML5 测试页面</title>
    <meta name="description" content="这是一个用于自动化测试、解析器测试和浏览器渲染评估的复杂 HTML 页面。">
    <meta name="author" content="System Tester">
  </head>
  <body>
    <main>
      <h1>QA 自动化测试平台示例页</h1>
      <form action="/submit" method="post">
        <input type="text" name="username">
        <button type="submit">提交</button>
      </form>
      <dialog open>这是一个对话框</dialog>
    </main>
  </body>
</html>`

func TestImportHTMLDocumentContentsStoresOriginalHTMLAndReturnsPreviewLink(t *testing.T) {
	t.Parallel()

	mediaDir := t.TempDir()
	result, err := importHTMLDocumentContents("complex-import.html", []byte(sampleImportedHTMLDocument), mediaDir, "/media", noopUploadCache{})
	if err != nil {
		t.Fatalf("importHTMLDocumentContents returned error: %v", err)
	}

	if result.Title != "QA 自动化测试平台示例页" {
		t.Fatalf("expected imported title, got %q", result.Title)
	}

	if result.Summary != "这是一个用于自动化测试、解析器测试和浏览器渲染评估的复杂 HTML 页面。" {
		t.Fatalf("expected summary from metadata, got %q", result.Summary)
	}

	if result.BodyFormat != BodyFormatHTML {
		t.Fatalf("expected body format %q, got %q", BodyFormatHTML, result.BodyFormat)
	}

	if !strings.Contains(result.Body, htmlImportPreviewRoute+"?src=/media/imports/") {
		t.Fatalf("expected preview link body, got %q", result.Body)
	}

	if strings.Contains(result.Body, "<form") || strings.Contains(result.Body, "<dialog") {
		t.Fatalf("expected body to contain preview link instead of raw html, got %q", result.Body)
	}

	references := extractMediaReferences(result.Body, "/media")
	if len(references) != 1 {
		t.Fatalf("expected one stored html reference, got %#v", references)
	}

	var publicPath string
	for candidate := range references {
		publicPath = candidate
	}

	storedPath := filepath.Join(mediaDir, filepath.FromSlash(strings.TrimPrefix(publicPath, "/media/")))
	storedBytes, err := os.ReadFile(storedPath)
	if err != nil {
		t.Fatalf("failed to read stored html file: %v", err)
	}

	if !bytes.Equal(storedBytes, []byte(sampleImportedHTMLDocument)) {
		t.Fatalf("expected stored html to match import payload")
	}
}

func TestPreviewImportedHTMLServesStoredDocumentWithSandboxHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mediaDir := t.TempDir()
	result, err := importHTMLDocumentContents("complex-import.html", []byte(sampleImportedHTMLDocument), mediaDir, "/media", noopUploadCache{})
	if err != nil {
		t.Fatalf("importHTMLDocumentContents returned error: %v", err)
	}

	references := extractMediaReferences(result.Body, "/media")
	if len(references) != 1 {
		t.Fatalf("expected one stored html reference, got %#v", references)
	}

	var publicPath string
	for candidate := range references {
		publicPath = candidate
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, htmlImportPreviewRoute+"?src="+url.QueryEscape(publicPath), nil)

	handler := NewHandler(nil, HandlerOptions{MediaDir: mediaDir, MediaURLPath: "/media"})
	handler.previewImportedHTML(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, recorder.Code, recorder.Body.String())
	}

	if !bytes.Equal(recorder.Body.Bytes(), []byte(sampleImportedHTMLDocument)) {
		t.Fatalf("expected preview response body to match stored html")
	}

	if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
		t.Fatalf("expected html content type, got %q", contentType)
	}

	if csp := recorder.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox") {
		t.Fatalf("expected sandbox csp header, got %q", csp)
	}
}
