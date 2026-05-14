package blog

import (
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeCreatePostInputSupportsHTMLBody(t *testing.T) {
	input := CreatePostInput{
		Title:      "Latency report",
		BodyFormat: BodyFormatHTML,
		Body:       `<article><h2>Overview</h2><p>p99 stayed below 20ms.</p><script>alert(1)</script></article>`,
	}

	normalized, err := normalizeCreatePostInput(input)
	if err != nil {
		t.Fatalf("normalizeCreatePostInput returned error: %v", err)
	}

	if normalized.BodyFormat != BodyFormatHTML {
		t.Fatalf("expected body format %q, got %q", BodyFormatHTML, normalized.BodyFormat)
	}

	if strings.Contains(normalized.Body, "script") {
		t.Fatalf("expected html body to be sanitized, got %q", normalized.Body)
	}

	if !strings.Contains(normalized.Summary, "Overview") || !strings.Contains(normalized.Summary, "p99 stayed below 20ms") {
		t.Fatalf("expected summary to be derived from html text, got %q", normalized.Summary)
	}
}

func TestParseHTMLImportDocumentExtractsMetadata(t *testing.T) {
	result, err := parseHTMLImportDocument("latency-report.html", `<!doctype html>
<html>
  <head>
    <title>Latency Report</title>
    <meta name="description" content="Imported HTML summary">
    <meta name="author" content="Ops Team">
    <meta name="keywords" content="perf, latency, perf">
    <meta property="article:published_time" content="2026-05-13T08:30:00Z">
  </head>
  <body>
    <article>
      <h1>Latency Report</h1>
      <p>p99 stayed below 20ms.</p>
      <img src="/media/latency.png" onerror="alert(1)">
    </article>
  </body>
</html>`)
	if err != nil {
		t.Fatalf("parseHTMLImportDocument returned error: %v", err)
	}

	if result.Title != "Latency Report" {
		t.Fatalf("expected title to be imported, got %q", result.Title)
	}

	if result.BodyFormat != BodyFormatHTML {
		t.Fatalf("expected body format %q, got %q", BodyFormatHTML, result.BodyFormat)
	}

	if strings.Contains(result.Body, "onerror") {
		t.Fatalf("expected imported html to be sanitized, got %q", result.Body)
	}

	if !strings.Contains(result.Body, "/media/latency.png") {
		t.Fatalf("expected imported html body to keep image source, got %q", result.Body)
	}

	if result.Summary != "Imported HTML summary" {
		t.Fatalf("expected summary from metadata, got %q", result.Summary)
	}

	if result.Author != "Ops Team" {
		t.Fatalf("expected author from metadata, got %q", result.Author)
	}

	if result.PublishedAt != "2026-05-13" {
		t.Fatalf("expected normalized publish date, got %q", result.PublishedAt)
	}

	if !reflect.DeepEqual(result.Tags, []string{"perf", "latency"}) {
		t.Fatalf("unexpected imported tags: %#v", result.Tags)
	}
}

func TestNormalizeCreatePostInputPreservesHTMLMathSemantics(t *testing.T) {
	input := CreatePostInput{
		Title:      "Math report",
		BodyFormat: BodyFormatHTML,
		Body: `<article><p><span data-math-expression="\\frac{a}{b}" data-math-display="true" data-math-format="tex">a/b</span></p>` +
			`<p><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><msup><mi>x</mi><mn>2</mn></msup></math></p></article>`,
	}

	normalized, err := normalizeCreatePostInput(input)
	if err != nil {
		t.Fatalf("normalizeCreatePostInput returned error: %v", err)
	}

	if !strings.Contains(normalized.Body, `data-math-expression="\\frac{a}{b}"`) {
		t.Fatalf("expected explicit data-math node to survive sanitization, got %q", normalized.Body)
	}

	if !strings.Contains(normalized.Body, `data-math-format="mathml"`) || !strings.Contains(normalized.Body, `data-math-expression="&lt;math`) {
		t.Fatalf("expected MathML to be converted into an explicit data-math node, got %q", normalized.Body)
	}

	if strings.Contains(normalized.Body, `<script`) {
		t.Fatalf("expected sanitizer to keep stripping script nodes, got %q", normalized.Body)
	}
}
