package blog

import (
	"strings"
	"testing"
)

func TestBuildSearchSnippetPrefersSummaryAndHighlightsMatch(t *testing.T) {
	post := Post{
		Title:      "一次 LLVM pass 的回归排查",
		Summary:    "定位 PMU 指标抖动，并记录 perf 与 flamegraph 结论。",
		BodyFormat: BodyFormatMarkdown,
		Body:       "# 背景\n\n正文里还有更多 perf 细节。",
	}

	snippet := buildSearchSnippet(post, "PMU perf")
	if snippet == nil {
		t.Fatal("expected search snippet")
	}

	if snippet.Field != "summary" {
		t.Fatalf("expected summary snippet, got %q", snippet.Field)
	}

	if !strings.Contains(snippet.HTML, "<mark>PMU</mark>") {
		t.Fatalf("expected PMU highlight, got %q", snippet.HTML)
	}
}

func TestBuildSearchSnippetFallsBackToBodyAndEscapesHTML(t *testing.T) {
	post := Post{
		Title:      "HTML import",
		Summary:    "",
		BodyFormat: BodyFormatHTML,
		Body:       `<article><p>Graph throughput stayed below < 20ms while cuda kernels were saturated.</p></article>`,
	}

	snippet := buildSearchSnippet(post, "cuda")
	if snippet == nil {
		t.Fatal("expected search snippet")
	}

	if snippet.Field != "body" {
		t.Fatalf("expected body snippet, got %q", snippet.Field)
	}

	if !strings.Contains(snippet.HTML, "<mark>cuda</mark>") {
		t.Fatalf("expected highlighted cuda token, got %q", snippet.HTML)
	}

	if strings.Contains(snippet.HTML, "< 20ms") {
		t.Fatalf("expected html to escape angle brackets, got %q", snippet.HTML)
	}
}
