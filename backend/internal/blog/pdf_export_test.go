package blog

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleWebPBase64 = "UklGRjYAAABXRUJQVlA4ICoAAABwAQCdASoCAAIAAgA0JaACdAFAAAD+771WBJWrN0/+bA/8g/+Qfc0AAAA="

func TestBuildPostPDFReturnsPDFDocument(t *testing.T) {
	fontPath, err := resolvePDFFontPath()
	if err != nil {
		t.Skipf("skip pdf export test without font: %v", err)
	}

	t.Setenv("BLOG_PDF_FONT_PATH", fontPath)

	pdfBytes, fileName, err := buildPostPDF(PDFExportInput{
		Title:       "Latency report",
		Summary:     "p99 kept under 20ms during the latest canary.",
		Category:    "Performance",
		Tags:        []string{"perf", "latency"},
		Author:      "Wanderlust",
		PublishedAt: "2026-05-14",
		BodyFormat:  BodyFormatMarkdown,
		Body:        "# Overview\n\n- p99 under 20ms\n- no timeout spikes\n\n```bash\ncurl /healthz\n```",
	}, PDFRenderOptions{})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if fileName == "" {
		t.Fatal("expected non-empty pdf filename")
	}

	if !bytes.HasPrefix(pdfBytes, []byte("%PDF")) {
		t.Fatalf("expected pdf header, got %q", pdfBytes[:min(len(pdfBytes), 8)])
	}
}

func TestBuildPostPDFRequiresValidPostBody(t *testing.T) {
	fontPath, err := resolvePDFFontPath()
	if err != nil {
		t.Skipf("skip pdf export test without font: %v", err)
	}

	t.Setenv("BLOG_PDF_FONT_PATH", fontPath)

	_, _, err = buildPostPDF(PDFExportInput{Title: "", Body: ""}, PDFRenderOptions{})
	if err != ErrInvalidPost {
		t.Fatalf("expected ErrInvalidPost, got %v", err)
	}
}

func TestBuildPostPDFEmbedsMarkdownImages(t *testing.T) {
	fontPath, err := resolvePDFFontPath()
	if err != nil {
		t.Skipf("skip pdf export test without font: %v", err)
	}

	t.Setenv("BLOG_PDF_FONT_PATH", fontPath)
	mediaDir := t.TempDir()
	writePNGFixture(t, filepath.Join(mediaDir, "diagram.png"))

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Image report",
		BodyFormat: BodyFormatMarkdown,
		Body:       "![diagram](/media/diagram.png)",
	}, PDFRenderOptions{MediaDir: mediaDir, MediaURLPath: "/media"})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected generated pdf to embed image objects")
	}
}

func TestBuildPostPDFEmbedsHTMLPictureImages(t *testing.T) {
	fontPath, err := resolvePDFFontPath()
	if err != nil {
		t.Skipf("skip pdf export test without font: %v", err)
	}

	t.Setenv("BLOG_PDF_FONT_PATH", fontPath)
	mediaDir := t.TempDir()
	writePNGFixture(t, filepath.Join(mediaDir, "diagram.png"))

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Picture report",
		BodyFormat: BodyFormatHTML,
		Body:       `<figure><picture><source srcset="/media/diagram.png 1x" type="image/png"><img src="/media/diagram.png" alt="diagram"></picture></figure>`,
	}, PDFRenderOptions{MediaDir: mediaDir, MediaURLPath: "/media"})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected generated pdf to embed picture image objects")
	}
}

func TestNormalizePDFSummaryStripsLeadingTitle(t *testing.T) {
	t.Parallel()

	summary := normalizePDFSummary("整合测试（仅覆盖指定15条规则）", "整合测试（仅覆盖指定15条规则） 本文覆盖以下 15 条内置规则")
	if summary != "本文覆盖以下 15 条内置规则" {
		t.Fatalf("unexpected normalized summary: %q", summary)
	}
}

func TestStripLeadingPDFTitleHeading(t *testing.T) {
	t.Parallel()

	bodyHTML := stripLeadingPDFTitleHeading("Overview", "<h1>Overview</h1><p>正文段落</p>")
	if strings.Contains(bodyHTML, "<h1>Overview</h1>") {
		t.Fatalf("expected leading title heading to be removed, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, "正文段落") {
		t.Fatalf("expected body content to be kept, got %q", bodyHTML)
	}
}

func TestNormalizePDFTextConvertsLatexExpressions(t *testing.T) {
	t.Parallel()

	normalized := normalizePDFText(`内联公式 $E=mc^2$ 和块公式 $$\frac{a}{b} + \sqrt{x}$$`)
	if strings.Contains(normalized, "$") {
		t.Fatalf("expected latex delimiters to be removed, got %q", normalized)
	}

	if !strings.Contains(normalized, `E=mc^2`) {
		t.Fatalf("expected inline math to stay readable, got %q", normalized)
	}

	if !strings.Contains(normalized, `(a)/(b) + √(x)`) {
		t.Fatalf("expected block math to be converted, got %q", normalized)
	}
}

func TestNormalizeCodeBlockTextExpandsTabs(t *testing.T) {
	t.Parallel()

	normalized := normalizeCodeBlockText("\tif ready {\n\t\treturn value\n\t}")
	if strings.ContainsRune(normalized, '\t') {
		t.Fatalf("expected tabs to be expanded, got %q", normalized)
	}

	if !strings.Contains(normalized, "    if ready {") {
		t.Fatalf("expected leading indentation to be preserved with spaces, got %q", normalized)
	}
}

func TestPreparePDFImageAssetSupportsSVGAndWebP(t *testing.T) {
	t.Parallel()

	webpBytes, err := base64.StdEncoding.DecodeString(sampleWebPBase64)
	if err != nil {
		t.Fatalf("failed to decode webp fixture: %v", err)
	}

	for _, testCase := range []struct {
		name        string
		cacheKey    string
		contentType string
		payload     []byte
	}{
		{
			name:        "svg",
			cacheKey:    "/media/diagram.svg",
			contentType: "image/svg+xml",
			payload: []byte(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">
  <rect width="12" height="12" fill="#0f766e" />
</svg>`),
		},
		{
			name:        "webp",
			cacheKey:    "/media/chart.webp",
			contentType: "image/webp",
			payload:     webpBytes,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			asset, err := preparePDFImageAsset(pdfImageSource{
				cacheKey:    testCase.cacheKey,
				contentType: testCase.contentType,
				data:        testCase.payload,
			})
			if err != nil {
				t.Fatalf("preparePDFImageAsset returned error: %v", err)
			}

			if asset.imageType != "PNG" {
				t.Fatalf("expected PNG image type, got %q", asset.imageType)
			}

			if _, _, err := image.DecodeConfig(bytes.NewReader(asset.data)); err != nil {
				t.Fatalf("expected a decodable raster image, got %v", err)
			}
		})
	}
}

func TestPreparePDFImageAssetSupportsExternalPNGLikeSource(t *testing.T) {
	t.Parallel()

	imageBuffer := bytes.NewBuffer(nil)
	pngImage := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			pngImage.Set(x, y, color.RGBA{R: 15, G: 118, B: 110, A: 255})
		}
	}
	if err := png.Encode(imageBuffer, pngImage); err != nil {
		t.Fatalf("failed to encode png fixture: %v", err)
	}

	asset, err := preparePDFImageAsset(pdfImageSource{
		cacheKey:    "https://cdn.example.com/chart.png",
		contentType: "image/png",
		data:        imageBuffer.Bytes(),
	})
	if err != nil {
		t.Fatalf("preparePDFImageAsset returned error: %v", err)
	}

	if asset == nil || len(asset.data) == 0 {
		t.Fatal("expected non-empty external png asset")
	}
}

func TestResolveImageAssetRejectsPrivateExternalImages(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "image/png")
		imageBuffer := bytes.NewBuffer(nil)
		pngImage := image.NewRGBA(image.Rect(0, 0, 4, 4))
		for y := 0; y < 4; y++ {
			for x := 0; x < 4; x++ {
				pngImage.Set(x, y, color.RGBA{R: 15, G: 118, B: 110, A: 255})
			}
		}
		if err := png.Encode(imageBuffer, pngImage); err != nil {
			t.Fatalf("failed to encode png fixture: %v", err)
		}

		_, _ = writer.Write(imageBuffer.Bytes())
	}))
	defer server.Close()

	renderer := &pdfRenderer{mediaURLPath: "/media"}
	asset, err := renderer.resolveImageAsset(server.URL + "/chart.png")
	if err == nil {
		t.Fatal("expected localhost external source to be rejected by SSRF guard")
	}
	if asset != nil {
		t.Fatal("expected no asset for rejected external image")
	}
}

func TestResolveImageAssetSupportsLocalSVGAndWebP(t *testing.T) {
	t.Parallel()

	mediaDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(mediaDir, "diagram.svg"), []byte(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">
  <circle cx="6" cy="6" r="5" fill="#0f766e" />
</svg>`), 0o600); err != nil {
		t.Fatalf("failed to write svg fixture: %v", err)
	}

	webpBytes, err := base64.StdEncoding.DecodeString(sampleWebPBase64)
	if err != nil {
		t.Fatalf("failed to decode webp fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(mediaDir, "chart.webp"), webpBytes, 0o600); err != nil {
		t.Fatalf("failed to write webp fixture: %v", err)
	}

	renderer := &pdfRenderer{mediaDir: mediaDir, mediaURLPath: "/media"}
	for _, source := range []string{"/media/diagram.svg", "/media/chart.webp"} {
		asset, err := renderer.resolveImageAsset(source)
		if err != nil {
			t.Fatalf("resolveImageAsset(%q) returned error: %v", source, err)
		}
		if asset == nil || len(asset.data) == 0 {
			t.Fatalf("resolveImageAsset(%q) returned empty asset", source)
		}
	}
}

func writePNGFixture(t *testing.T, filePath string) {
	t.Helper()

	imageBuffer := bytes.NewBuffer(nil)
	pngImage := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			pngImage.Set(x, y, color.RGBA{R: 15, G: 118, B: 110, A: 255})
		}
	}
	if err := png.Encode(imageBuffer, pngImage); err != nil {
		t.Fatalf("failed to encode png fixture: %v", err)
	}

	if err := os.WriteFile(filePath, imageBuffer.Bytes(), 0o600); err != nil {
		t.Fatalf("failed to write png fixture: %v", err)
	}
}

func min(left int, right int) int {
	if left < right {
		return left
	}

	return right
}
