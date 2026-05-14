package blog

import (
	"bytes"
	"testing"
)

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

func min(left int, right int) int {
	if left < right {
		return left
	}

	return right
}
