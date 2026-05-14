package blog

import (
	"bytes"
	"context"
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
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const sampleWebPBase64 = "UklGRjYAAABXRUJQVlA4ICoAAABwAQCdASoCAAIAAgA0JaACdAFAAAD+771WBJWrN0/+bA/8g/+Qfc0AAAA="

func requireChromiumForPDFTests(t *testing.T) {
	t.Helper()

	if _, err := resolvePDFChromiumExecutable(); err != nil {
		t.Skipf("skip pdf export test without chromium: %v", err)
	}
}

func newPDFMediaServer(t *testing.T, mediaDir string) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(mediaDir))))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestBuildPostPDFReturnsPDFDocument(t *testing.T) {
	requireChromiumForPDFTests(t)

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
	requireChromiumForPDFTests(t)

	var err error
	_, _, err = buildPostPDF(PDFExportInput{Title: "", Body: ""}, PDFRenderOptions{})
	if err != ErrInvalidPost {
		t.Fatalf("expected ErrInvalidPost, got %v", err)
	}
}

func TestBuildPostPDFEmbedsMarkdownImages(t *testing.T) {
	requireChromiumForPDFTests(t)
	mediaDir := t.TempDir()
	writePNGFixture(t, filepath.Join(mediaDir, "diagram.png"))
	mediaServer := newPDFMediaServer(t, mediaDir)

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Image report",
		BodyFormat: BodyFormatMarkdown,
		Body:       "![diagram](/media/diagram.png)",
	}, PDFRenderOptions{MediaDir: mediaDir, MediaURLPath: "/media", BaseURL: mediaServer.URL})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected generated pdf to embed image objects")
	}
}

func TestBuildPostPDFEmbedsHTMLPictureImages(t *testing.T) {
	requireChromiumForPDFTests(t)
	mediaDir := t.TempDir()
	writePNGFixture(t, filepath.Join(mediaDir, "diagram.png"))
	mediaServer := newPDFMediaServer(t, mediaDir)

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Picture report",
		BodyFormat: BodyFormatHTML,
		Body:       `<figure><picture><source srcset="/media/diagram.png 1x" type="image/png"><img src="/media/diagram.png" alt="diagram"></picture></figure>`,
	}, PDFRenderOptions{MediaDir: mediaDir, MediaURLPath: "/media", BaseURL: mediaServer.URL})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected generated pdf to embed picture image objects")
	}
}

func TestBuildPostPDFRendersTablesAsBrowserFragments(t *testing.T) {
	requireChromiumForPDFTests(t)

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Table report",
		BodyFormat: BodyFormatHTML,
		Body:       `<table><thead><tr><th>版本</th><th>状态</th></tr></thead><tbody><tr><td>v1</td><td>稳定</td></tr></tbody></table>`,
	}, PDFRenderOptions{})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected table fragment to be rasterized into an embedded image")
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

func TestRenderPostBodyHTMLConvertsLatexOutsideCodeBlocks(t *testing.T) {
	t.Parallel()

	bodyHTML, err := renderPostBodyHTML("Overview", "内联公式 $E=mc^2$\n\n$$\\frac{a}{b} + \\sqrt{x}$$\n\n```tex\n$E=mc^2$\n```", BodyFormatMarkdown)
	if err != nil {
		t.Fatalf("renderPostBodyHTML returned error: %v", err)
	}

	if !strings.Contains(bodyHTML, "E=mc^2") {
		t.Fatalf("expected inline math to be converted in html, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, "(a)/(b) + √(x)") {
		t.Fatalf("expected block math to be converted in html, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, `data-pdf-browser="math"`) {
		t.Fatalf("expected math content to be marked for browser rendering, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="E=mc^2"`) {
		t.Fatalf("expected inline math placeholder expression, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="\frac{a}{b} + \sqrt{x}"`) {
		t.Fatalf("expected block math placeholder without delimiters, got %q", bodyHTML)
	}

	if strings.Contains(bodyHTML, `data-pdf-math-expression="$$`) {
		t.Fatalf("expected block math delimiters to be stripped before browser rendering, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, "&lt;code class=\"language-tex\"&gt;$E=mc^2$") && !strings.Contains(bodyHTML, "$E=mc^2$") {
		t.Fatalf("expected code block latex to stay raw, got %q", bodyHTML)
	}
}

func TestRenderPostBodyHTMLStripsSpacedBlockMathDelimiters(t *testing.T) {
	t.Parallel()

	bodyHTML, err := renderPostBodyHTML("目标", "$$ S_q = \\log\\left(\\frac{T_{00}}{T_q}\\right) $$", BodyFormatMarkdown)
	if err != nil {
		t.Fatalf("renderPostBodyHTML returned error: %v", err)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="S_q = \log\left(\frac{T_{00}}{T_q}\right)"`) {
		t.Fatalf("expected spaced block math placeholder without delimiters, got %q", bodyHTML)
	}

	if strings.Contains(bodyHTML, `data-pdf-math-expression="$$`) {
		t.Fatalf("expected spaced block math delimiters to be stripped, got %q", bodyHTML)
	}
}

func TestRenderPostBodyHTMLMarksStandaloneLatexParagraphs(t *testing.T) {
	t.Parallel()

	bodyHTML, err := renderPostBodyHTML("Scoring", "绝对分数：\n\nS_q = log(\\frac{T_00}{T_q})\n\n解码：\n\n\\hat r^gated_{q,k} = \\hat r^\\cal_{q,k} \\cdot (1 - p_tie)^\\gamma", BodyFormatMarkdown)
	if err != nil {
		t.Fatalf("renderPostBodyHTML returned error: %v", err)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="S_q = log(\frac{T_00}{T_q})"`) {
		t.Fatalf("expected standalone score formula to be marked for browser rendering, got %q", bodyHTML)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="\hat r^gated_{q,k} = \hat r^\cal_{q,k} \cdot (1 - p_tie)^\gamma"`) {
		t.Fatalf("expected standalone gated formula to be marked for browser rendering, got %q", bodyHTML)
	}
}

func TestRenderPostBodyHTMLMarksStandalonePairwiseFormulaLine(t *testing.T) {
	t.Parallel()

	bodyHTML, err := renderPostBodyHTML("目标", "\\hat r_q,k = model(q, a_k)", BodyFormatMarkdown)
	if err != nil {
		t.Fatalf("renderPostBodyHTML returned error: %v", err)
	}

	if !strings.Contains(bodyHTML, `data-pdf-math-expression="\hat r_q,k = model(q, a_k)"`) {
		t.Fatalf("expected standalone pairwise formula to be marked for browser rendering, got %q", bodyHTML)
	}
}

func TestBuildPostPDFRendersStandaloneLatexParagraphsAsBrowserFragments(t *testing.T) {
	requireChromiumForPDFTests(t)

	pdfBytes, _, err := buildPostPDF(PDFExportInput{
		Title:      "Formula report",
		BodyFormat: BodyFormatMarkdown,
		Body:       "绝对分数：\n\nS_q = log(\\frac{T_00}{T_q})\n\n解码：\n\n\\hat r^gated_{q,k} = \\hat r^\\cal_{q,k} \\cdot (1 - p_tie)^\\gamma",
	}, PDFRenderOptions{})
	if err != nil {
		t.Fatalf("buildPostPDF returned error: %v", err)
	}

	if !bytes.Contains(pdfBytes, []byte("/Subtype /Image")) {
		t.Fatalf("expected standalone formula paragraphs to be rasterized into embedded images")
	}
}

func TestBuildPDFFragmentDocumentHTMLUsesLocalKaTeXAssets(t *testing.T) {
	t.Parallel()

	documentHTML := buildPDFFragmentDocumentHTML(`<p><span class="pdf-math-fragment" data-pdf-math-expression="E=mc^2" data-pdf-math-display="false">E=mc^2</span></p>`, 640, 592, pdfKaTeXAssets{
		cssDataURL: "data:text/css;base64,YQ==",
		jsDataURL:  "data:text/javascript;base64,Yg==",
	})

	if strings.Contains(documentHTML, "cdn.jsdelivr.net") {
		t.Fatalf("expected fragment html not to depend on external cdn, got %q", documentHTML)
	}

	if !strings.Contains(documentHTML, "data:text/css;base64,YQ==") {
		t.Fatalf("expected embedded katex stylesheet, got %q", documentHTML)
	}

	if !strings.Contains(documentHTML, "data:text/javascript;base64,Yg==") {
		t.Fatalf("expected embedded katex script, got %q", documentHTML)
	}
}

func TestPDFFragmentDocumentRendersKaTeXWithChromium(t *testing.T) {
	requireChromiumForPDFTests(t)

	assets := loadPDFKaTeXAssets()
	if assets.cssDataURL == "" || assets.jsDataURL == "" {
		t.Skip("skip chromium katex render test without local katex assets")
	}

	documentHTML := buildPDFFragmentDocumentHTML(`<p><span class="pdf-math-fragment" data-pdf-math-expression="E=mc^2" data-pdf-math-display="false">E=mc^2</span></p>`, 640, 592, assets)
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		t.Fatalf("resolvePDFChromiumExecutable returned error: %v", err)
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 20*time.Second)
	defer cancelTimeout()

	var renderedHTML string
	err = chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(640, 480),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-ready='true']", chromedp.ByQuery),
		chromedp.InnerHTML(".pdf-math-fragment", &renderedHTML, chromedp.ByQuery),
	)
	if err != nil {
		t.Fatalf("expected chromium to render math fragment, got error: %v", err)
	}

	if !strings.Contains(renderedHTML, "katex") {
		t.Fatalf("expected katex markup after chromium render, got %q", renderedHTML)
	}
}

func TestPDFFragmentDocumentRendersCommonScriptShorthand(t *testing.T) {
	requireChromiumForPDFTests(t)

	assets := loadPDFKaTeXAssets()
	if assets.cssDataURL == "" || assets.jsDataURL == "" {
		t.Skip("skip chromium katex shorthand test without local katex assets")
	}

	documentHTML := buildPDFFragmentDocumentHTML(`<p><span class="pdf-math-fragment" data-pdf-math-expression="\hat r^gated_{q,k} = \hat r^\cal_{q,k} \cdot (1 - p_tie)^\gamma" data-pdf-math-display="true">placeholder</span></p>`, 640, 592, assets)
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		t.Fatalf("resolvePDFChromiumExecutable returned error: %v", err)
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 20*time.Second)
	defer cancelTimeout()

	var renderedHTML string
	err = chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(640, 480),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-ready='true']", chromedp.ByQuery),
		chromedp.OuterHTML(".pdf-math-fragment", &renderedHTML, chromedp.ByQuery),
	)
	if err != nil {
		t.Fatalf("expected chromium to render shorthand math fragment, got error: %v", err)
	}

	if strings.Contains(renderedHTML, "katex-error") || strings.Contains(renderedHTML, `\hat r`) {
		t.Fatalf("expected shorthand math to avoid raw katex error output, got %q", renderedHTML)
	}
}

func TestPDFFragmentDocumentRendersRawSlashMathNodeWithChromium(t *testing.T) {
	requireChromiumForPDFTests(t)

	assets := loadPDFKaTeXAssets()
	if assets.cssDataURL == "" || assets.jsDataURL == "" {
		t.Skip("skip chromium raw math render test without local katex assets")
	}

	documentHTML := buildPDFFragmentDocumentHTML(`<p data-pdf-browser="math">\hat r_q,k = model(q, a_k)</p>`, 640, 592, assets)
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		t.Fatalf("resolvePDFChromiumExecutable returned error: %v", err)
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 20*time.Second)
	defer cancelTimeout()

	var renderedHTML string
	err = chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(640, 480),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-ready='true']", chromedp.ByQuery),
		chromedp.InnerHTML("[data-pdf-browser='math']", &renderedHTML, chromedp.ByQuery),
	)
	if err != nil {
		t.Fatalf("expected chromium to render raw slash math node, got error: %v", err)
	}

	if !strings.Contains(renderedHTML, "katex") {
		t.Fatalf("expected raw slash math node to be rendered by katex, got %q", renderedHTML)
	}
}

func TestPDFFragmentDocumentSkipsNonEnglishRawSlashNodeWithChromium(t *testing.T) {
	requireChromiumForPDFTests(t)

	assets := loadPDFKaTeXAssets()
	if assets.cssDataURL == "" || assets.jsDataURL == "" {
		t.Skip("skip chromium non-english raw math test without local katex assets")
	}

	documentHTML := buildPDFFragmentDocumentHTML(`<p data-pdf-browser="math">说明：\hat r_q,k = model(q, a_k)</p>`, 640, 592, assets)
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		t.Fatalf("resolvePDFChromiumExecutable returned error: %v", err)
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 20*time.Second)
	defer cancelTimeout()

	var renderedHTML string
	err = chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(640, 480),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-ready='true']", chromedp.ByQuery),
		chromedp.InnerHTML("[data-pdf-browser='math']", &renderedHTML, chromedp.ByQuery),
	)
	if err != nil {
		t.Fatalf("expected chromium to skip non-english raw slash node without error, got: %v", err)
	}

	if strings.Contains(renderedHTML, "katex") {
		t.Fatalf("expected non-english raw slash node to stay unrendered, got %q", renderedHTML)
	}
}

func TestExtractPDFTableRowsPreservesHeadersAndCells(t *testing.T) {
	t.Parallel()

	document, err := htmlnode.Parse(strings.NewReader(`<table><thead><tr><th>版本</th><th>状态</th></tr></thead><tbody><tr><td>v1</td><td>稳定</td></tr></tbody></table>`))
	if err != nil {
		t.Fatalf("failed to parse table html: %v", err)
	}

	table := findFirstNodeByAtom(document, atom.Table)
	rows := extractPDFTableRows(table)
	if len(rows) != 2 {
		t.Fatalf("expected 2 table rows, got %#v", rows)
	}

	if !rows[0].cells[0].isHeader || !rows[0].cells[1].isHeader {
		t.Fatalf("expected header row to keep header flags, got %#v", rows[0])
	}

	if rows[1].cells[0].text != "v1" || rows[1].cells[1].text != "稳定" {
		t.Fatalf("unexpected table body cells: %#v", rows[1])
	}
}

func TestAnalyzePDFRenderProfilePrefersLegacyRendererForLargeHTML(t *testing.T) {
	t.Parallel()

	profile := analyzePDFRenderProfile(strings.Repeat("a", pdfChromiumHTMLByteLimit+1), PDFRenderOptions{})
	if !profile.shouldPreferLegacyRenderer() {
		t.Fatalf("expected large html body to prefer legacy renderer, got %#v", profile)
	}

	if profile.shouldReject() {
		t.Fatalf("expected large html body to stay exportable, got %#v", profile)
	}
}

func TestAnalyzePDFRenderProfileRejectsExcessiveHTML(t *testing.T) {
	t.Parallel()

	profile := analyzePDFRenderProfile(strings.Repeat("a", pdfAbsoluteHTMLByteLimit+1), PDFRenderOptions{})
	if !profile.shouldReject() {
		t.Fatalf("expected oversized html body to be rejected, got %#v", profile)
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
