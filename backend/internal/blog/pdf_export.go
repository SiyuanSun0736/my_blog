package blog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"html/template"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/phpdave11/gofpdf"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type PDFRenderOptions struct {
	MediaDir     string
	MediaURLPath string
	BaseURL      string
}

type normalizedPDFExport struct {
	Title       string
	Summary     string
	Category    string
	Tags        []string
	Author      string
	PublishedAt string
	Accent      string
	BodyFormat  BodyFormat
	Body        string
}

type pdfRenderer struct {
	pdf          *gofpdf.Fpdf
	fontFamily   string
	mediaDir     string
	mediaURLPath string
	pageWidth    float64
	leftMargin   float64
	rightMargin  float64
	browser      *pdfFragmentBrowserRenderer
}

type printablePDFDocument struct {
	BaseURL     string
	AccentColor string
	Title       string
	Summary     string
	Category    string
	Tags        []string
	Author      string
	PublishedAt string
	BodyHTML    template.HTML
}

type pdfRenderProfile struct {
	htmlBytes          int
	imageCount         int
	externalImageCount int
	localImageBytes    int64
}

type pdfKaTeXAssets struct {
	cssDataURL string
	jsDataURL  string
}

type pdfTableCell struct {
	text     string
	isHeader bool
}

type pdfTableRow struct {
	cells []pdfTableCell
}

type pdfFragmentBrowserRenderer struct {
	assets          pdfKaTeXAssets
	allocatorCtx    context.Context
	cancelAllocator context.CancelFunc
	browserCtx      context.Context
	cancelBrowser   context.CancelFunc
}

var ErrPDFTooLarge = errors.New("pdf export too large")

const (
	pdfBrowserRenderAttrName  = "data-pdf-browser"
	pdfBrowserRenderMathValue = "math"
	pdfMathExpressionAttrName = "data-pdf-math-expression"
	pdfMathDisplayAttrName    = "data-pdf-math-display"
	pdfKaTeXVersion           = "0.16.45"
)

var (
	defaultPDFBaseURL                        = "http://127.0.0.1:8080/"
	pdfChromiumHTMLByteLimit                 = 256 * 1024
	pdfAbsoluteHTMLByteLimit                 = 1024 * 1024
	pdfChromiumImageCountLimit               = 6
	pdfAbsoluteImageCountLimit               = 16
	pdfChromiumExternalImageCountLimit       = 1
	pdfAbsoluteExternalImageCountLimit       = 3
	pdfChromiumLocalImageByteLimit     int64 = maxPDFImageBytes
	pdfAbsoluteLocalImageByteLimit     int64 = 2 * maxPDFImageBytes
	pdfAccentHexPattern                      = regexp.MustCompile(`#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})`)
	markdownToHTML                           = goldmark.New(goldmark.WithExtensions(extension.GFM))
	pdfBlockMathPattern                      = regexp.MustCompile(`(?s)(\$\$(.+?)\$\$|\\\[(.+?)\\\])`)
	pdfInlineMathPattern                     = regexp.MustCompile(`(\\\((.+?)\\\)|\$([^$\n]+?)\$)`)
	pdfLatexFractionPattern                  = regexp.MustCompile(`\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}`)
	pdfLatexSqrtPattern                      = regexp.MustCompile(`\\sqrt\s*\{([^{}]+)\}`)
	pdfLatexTextPattern                      = regexp.MustCompile(`\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]+)\}`)
	pdfChromiumCandidates                    = []string{
		"chromium",
		"chromium-browser",
		"google-chrome",
		"google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	}
	pdfFontCandidates = []string{
		"/usr/share/fonts/droid-nonlatin/DroidSansFallbackFull.ttf",
		"/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
		"/usr/share/fonts/droid-nonlatin/DroidSansFallback.ttf",
		"/usr/share/fonts/truetype/droid/DroidSansFallback.ttf",
	}
	pdfKaTeXAssetDirCandidates = []string{
		"/usr/local/share/blog-api/pdf-assets",
		"/app/pdf-assets",
		"../frontend/node_modules/katex/dist",
		"frontend/node_modules/katex/dist",
	}
	pdfLaTeXSymbolReplacer = strings.NewReplacer(
		`\times`, `×`,
		`\cdot`, `·`,
		`\pm`, `±`,
		`\leq`, `≤`,
		`\geq`, `≥`,
		`\neq`, `≠`,
		`\approx`, `≈`,
		`\rightarrow`, `→`,
		`\to`, `→`,
		`\leftarrow`, `←`,
		`\leftrightarrow`, `↔`,
		`\infty`, `∞`,
		`\sum`, `∑`,
		`\prod`, `∏`,
		`\int`, `∫`,
		`\partial`, `∂`,
		`\nabla`, `∇`,
		`\alpha`, `α`,
		`\beta`, `β`,
		`\gamma`, `γ`,
		`\delta`, `δ`,
		`\Delta`, `Δ`,
		`\theta`, `θ`,
		`\lambda`, `λ`,
		`\mu`, `μ`,
		`\pi`, `π`,
		`\sigma`, `σ`,
		`\phi`, `φ`,
		`\omega`, `ω`,
		`\Omega`, `Ω`,
		`\log`, `log`,
		`\ln`, `ln`,
		`\left`, ``,
		`\right`, ``,
		`\,`, ` `,
		`\;`, ` `,
		`\:`, ` `,
		`\!`, ``,
		`\\`, ` `,
	)
	pdfKaTeXAssetsOnce       sync.Once
	cachedPDFKaTeXAssets     pdfKaTeXAssets
	pdfPrintDocumentTemplate = template.Must(template.New("post-pdf").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>{{ .Title }}</title>
	{{ if .BaseURL }}<base href="{{ .BaseURL }}" />{{ end }}
	<style>
		@page {
			size: A4;
			margin: 0;
		}

		:root {
			color-scheme: light;
			--surface: #f6f1e8;
			--panel: rgba(255, 248, 239, 0.96);
			--panel-soft: rgba(255, 255, 255, 0.72);
			--ink: #24180f;
			--muted: #625244;
			--accent: {{ .AccentColor }};
			--accent-warm: #f59e0b;
		}

		* {
			box-sizing: border-box;
		}

		html,
		body {
			margin: 0;
			padding: 0;
			background: var(--surface);
			color: var(--ink);
			font-family: "Droid Sans Fallback", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		body {
			padding: 16mm;
		}

		.page {
			max-width: 178mm;
			margin: 0 auto;
		}

		.hero {
			overflow: hidden;
			border: 1px solid rgba(36, 24, 15, 0.08);
			border-radius: 20px;
			background: var(--panel);
			box-shadow: 0 24px 80px rgba(77, 53, 35, 0.12);
		}

		.hero-accent {
			height: 7px;
			background: linear-gradient(90deg, var(--accent) 0%, var(--accent-warm) 100%);
		}

		.hero-body {
			padding: 18px 22px 22px;
		}

		.eyebrow {
			margin: 0;
			font-size: 11px;
			letter-spacing: 0.28em;
			text-transform: uppercase;
			color: var(--muted);
		}

		.title {
			margin: 14px 0 0;
			font-size: 31px;
			line-height: 1.15;
			letter-spacing: -0.03em;
			color: var(--ink);
		}

		.summary {
			margin: 16px 0 0;
			font-size: 15px;
			line-height: 1.8;
			color: rgba(36, 24, 15, 0.84);
			white-space: pre-wrap;
		}

		.meta-grid {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 12px;
			margin-top: 18px;
		}

		.meta-card {
			border: 1px solid rgba(36, 24, 15, 0.08);
			border-radius: 16px;
			background: var(--panel-soft);
			padding: 14px 16px;
			break-inside: avoid;
		}

		.meta-label {
			margin: 0;
			font-size: 10px;
			letter-spacing: 0.22em;
			text-transform: uppercase;
			color: var(--muted);
		}

		.meta-value {
			margin: 8px 0 0;
			font-size: 14px;
			line-height: 1.6;
			color: var(--ink);
			word-break: break-word;
		}

		.tag-row {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 14px;
		}

		.tag {
			display: inline-flex;
			align-items: center;
			border-radius: 999px;
			border: 1px solid rgba(36, 24, 15, 0.1);
			background: rgba(255, 255, 255, 0.7);
			padding: 5px 10px;
			font-size: 12px;
			line-height: 1.4;
			color: var(--muted);
		}

		.content-card {
			margin-top: 18px;
			border: 1px solid rgba(36, 24, 15, 0.08);
			border-radius: 20px;
			background: rgba(255, 255, 255, 0.7);
			padding: 22px;
			box-shadow: 0 18px 60px rgba(75, 54, 34, 0.08);
		}

		.story-prose {
			display: grid;
			gap: 1.2rem;
		}

		.story-prose > * {
			margin: 0;
		}

		.story-prose :where(p, li, blockquote, td, th, a, code) {
			overflow-wrap: anywhere;
		}

		.story-prose h1,
		.story-prose h2,
		.story-prose h3,
		.story-prose h4 {
			color: var(--ink);
			letter-spacing: -0.03em;
			line-height: 1.2;
			break-after: avoid;
		}

		.story-prose h1 {
			font-size: 28px;
		}

		.story-prose h2 {
			font-size: 24px;
		}

		.story-prose h3 {
			font-size: 20px;
		}

		.story-prose p,
		.story-prose li,
		.story-prose blockquote,
		.story-prose td,
		.story-prose th {
			margin: 0;
			font-size: 14px;
			line-height: 1.9;
			color: rgba(36, 24, 15, 0.88);
			white-space: pre-wrap;
		}

		.story-prose ul,
		.story-prose ol {
			display: grid;
			gap: 0.65rem;
			padding-left: 1.35rem;
		}

		.story-prose blockquote {
			border-left: 3px solid rgba(15, 118, 110, 0.35);
			border-radius: 0 1rem 1rem 0;
			background: rgba(15, 118, 110, 0.07);
			padding: 0.95rem 1.1rem;
			break-inside: avoid;
		}

		.story-prose hr {
			width: 100%;
			border: 0;
			border-top: 1px solid rgba(36, 24, 15, 0.12);
		}

		.story-prose a {
			color: inherit;
			text-decoration: underline;
			text-decoration-thickness: 1px;
			text-underline-offset: 0.2em;
		}

		.story-prose code {
			border-radius: 0.45rem;
			background: rgba(36, 24, 15, 0.08);
			padding: 0.12rem 0.35rem;
			font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
			font-size: 0.92rem;
		}

		.story-prose pre {
			overflow-x: auto;
			border-radius: 1.1rem;
			border: 1px solid rgba(36, 24, 15, 0.12);
			background: linear-gradient(180deg, rgba(255, 251, 245, 0.96), rgba(247, 239, 228, 0.96));
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
			padding: 1rem 1.05rem;
			white-space: pre-wrap;
			break-inside: avoid;
		}

		.story-prose pre code {
			display: block;
			min-width: 0;
			background: transparent;
			padding: 0;
			color: rgba(36, 24, 15, 0.92);
			line-height: 1.72;
			white-space: pre-wrap;
		}

		.story-prose table {
			width: 100%;
			border-collapse: collapse;
			table-layout: fixed;
			break-inside: avoid;
		}

		.story-prose th,
		.story-prose td {
			border-bottom: 1px solid rgba(36, 24, 15, 0.12);
			padding: 0.65rem 0.75rem;
			text-align: left;
			font-size: 0.92rem;
			line-height: 1.7;
			vertical-align: top;
		}

		.story-prose img,
		.story-prose video,
		.story-prose iframe {
			display: block;
			max-width: 100%;
			border-radius: 1rem;
			break-inside: avoid;
		}

		.story-prose figure,
		.story-prose picture {
			margin: 0;
			break-inside: avoid;
		}
	</style>
	<script>
		window.addEventListener("load", function () {
			var markReady = function () {
				document.body.setAttribute("data-pdf-ready", "true");
			};
			var finish = function () {
				window.requestAnimationFrame(function () {
					window.requestAnimationFrame(markReady);
				});
			};
			if (document.fonts && document.fonts.ready) {
				document.fonts.ready.then(finish, finish);
				return;
			}
			finish();
		});
	</script>
</head>
<body>
	<main class="page">
		<section class="hero">
			<div class="hero-accent"></div>
			<div class="hero-body">
				<p class="eyebrow">Wanderlust Notes</p>
				<h1 class="title">{{ .Title }}</h1>
				{{ if .Summary }}<p class="summary">{{ .Summary }}</p>{{ end }}
				<div class="meta-grid">
					<section class="meta-card">
						<p class="meta-label">发布时间</p>
						<p class="meta-value">{{ .PublishedAt }}</p>
					</section>
					<section class="meta-card">
						<p class="meta-label">作者</p>
						<p class="meta-value">{{ .Author }}</p>
					</section>
					<section class="meta-card">
						<p class="meta-label">栏目</p>
						<p class="meta-value">{{ .Category }}</p>
					</section>
				</div>
				{{ if .Tags }}
				<div class="tag-row">
					{{ range .Tags }}<span class="tag">#{{ . }}</span>{{ end }}
				</div>
				{{ end }}
			</div>
		</section>

		<article class="content-card">
			<div class="story-prose">{{ .BodyHTML }}</div>
		</article>
	</main>
</body>
</html>`))
)

func buildPostPDF(input PDFExportInput, options PDFRenderOptions) ([]byte, string, error) {
	normalized, err := normalizePDFExportInput(input)
	if err != nil {
		return nil, "", err
	}

	bodyHTML, err := renderPostBodyHTML(normalized.Title, normalized.Body, normalized.BodyFormat)
	if err != nil {
		return nil, "", err
	}

	renderProfile := analyzePDFRenderProfile(bodyHTML, options)
	if renderProfile.shouldReject() {
		return nil, "", ErrPDFTooLarge
	}

	pdfBytes, err := buildLegacyPostPDF(normalized, bodyHTML, options)
	if err != nil {
		return nil, "", err
	}

	return pdfBytes, buildPDFFileName(normalized.Title), nil
}

func pdfExportInputFromPost(post Post) PDFExportInput {
	return PDFExportInput{
		Title:       post.Title,
		Summary:     post.Summary,
		Category:    post.Category,
		Tags:        post.Tags,
		Author:      post.Author,
		PublishedAt: post.PublishedAt,
		Accent:      post.Accent,
		BodyFormat:  post.BodyFormat,
		Body:        post.Body,
	}
}

func normalizePDFExportInput(input PDFExportInput) (normalizedPDFExport, error) {
	normalized, err := normalizeCreatePostInput(CreatePostInput{
		Title:       input.Title,
		Summary:     input.Summary,
		Category:    input.Category,
		Tags:        input.Tags,
		Author:      input.Author,
		PublishedAt: input.PublishedAt,
		Accent:      input.Accent,
		BodyFormat:  input.BodyFormat,
		Body:        input.Body,
	})
	if err != nil {
		return normalizedPDFExport{}, err
	}

	return normalizedPDFExport{
		Title:       normalized.Title,
		Summary:     normalized.Summary,
		Category:    normalized.Category,
		Tags:        normalized.Tags,
		Author:      normalized.Author,
		PublishedAt: normalized.PublishedAt,
		Accent:      normalized.Accent,
		BodyFormat:  normalized.BodyFormat,
		Body:        normalized.Body,
	}, nil
}

func buildPrintablePDFHTML(document normalizedPDFExport, options PDFRenderOptions) (string, error) {
	bodyHTML, err := renderPostBodyHTML(document.Title, document.Body, document.BodyFormat)
	if err != nil {
		return "", err
	}

	return buildPrintablePDFHTMLFromBody(document, bodyHTML, options)
}

func buildPrintablePDFHTMLFromBody(document normalizedPDFExport, bodyHTML string, options PDFRenderOptions) (string, error) {

	data := printablePDFDocument{
		BaseURL:     normalizePDFBaseURL(options.BaseURL),
		AccentColor: pdfAccentCSSColor(document.Accent),
		Title:       document.Title,
		Summary:     normalizePDFSummary(document.Title, document.Summary),
		Category:    document.Category,
		Tags:        document.Tags,
		Author:      document.Author,
		PublishedAt: document.PublishedAt,
		BodyHTML:    template.HTML(bodyHTML),
	}

	var buffer bytes.Buffer
	if err := pdfPrintDocumentTemplate.Execute(&buffer, data); err != nil {
		return "", err
	}

	return buffer.String(), nil
}

func buildLegacyPostPDF(document normalizedPDFExport, bodyHTML string, options PDFRenderOptions) ([]byte, error) {
	fontPath, err := resolvePDFFontPath()
	if err != nil {
		return nil, err
	}

	pdf := gofpdf.New("P", "mm", "A4", filepath.Dir(fontPath))
	pdf.SetMargins(18, 18, 18)
	pdf.SetAutoPageBreak(true, 18)
	pdf.SetTitle(document.Title, true)
	pdf.SetAuthor(document.Author, true)
	pdf.SetSubject(document.Category, true)
	pdf.SetCreator("Wanderlust blog-api", true)
	pdf.SetCompression(true)
	pdf.AddUTF8Font("blog-body", "", filepath.Base(fontPath))
	pdf.AddPage()
	pdf.SetFont("blog-body", "", 12)

	leftMargin, _, rightMargin, _ := pdf.GetMargins()
	pageWidth, _ := pdf.GetPageSize()
	renderer := &pdfRenderer{
		pdf:          pdf,
		fontFamily:   "blog-body",
		mediaDir:     strings.TrimSpace(options.MediaDir),
		mediaURLPath: normalizeMediaURLPath(options.MediaURLPath),
		pageWidth:    pageWidth,
		leftMargin:   leftMargin,
		rightMargin:  rightMargin,
	}
	defer renderer.close()

	renderer.renderHeader(document)
	if err := renderer.renderBody(bodyHTML); err != nil {
		return nil, err
	}

	var buffer bytes.Buffer
	if err := pdf.Output(&buffer); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

func analyzePDFRenderProfile(bodyHTML string, options PDFRenderOptions) pdfRenderProfile {
	profile := pdfRenderProfile{htmlBytes: len(bodyHTML)}
	trimmedBodyHTML := strings.TrimSpace(bodyHTML)
	if trimmedBodyHTML == "" {
		return profile
	}

	document, err := htmlnode.Parse(strings.NewReader(trimmedBodyHTML))
	if err != nil {
		return profile
	}

	root := findFirstNodeByAtom(document, atom.Body)
	if root == nil {
		root = document
	}

	seenLocalImages := make(map[string]struct{})
	seenExternalImages := make(map[string]struct{})
	mediaDir := strings.TrimSpace(options.MediaDir)
	mediaURLPath := normalizeMediaURLPath(options.MediaURLPath)

	var walk func(*htmlnode.Node)
	walk = func(node *htmlnode.Node) {
		if node == nil {
			return
		}

		if node.Type == htmlnode.ElementNode {
			switch node.DataAtom {
			case atom.Picture:
				imageSource, _ := pictureImageSource(node)
				profile.recordImageSource(imageSource, mediaDir, mediaURLPath, seenLocalImages, seenExternalImages)
				return
			case atom.Img:
				if node.Parent != nil && node.Parent.Type == htmlnode.ElementNode && node.Parent.DataAtom == atom.Picture {
					return
				}
				profile.recordImageSource(htmlAttribute(node, "src"), mediaDir, mediaURLPath, seenLocalImages, seenExternalImages)
			}
		}

		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}

	walk(root)
	return profile
}

func (profile *pdfRenderProfile) recordImageSource(
	rawSource string,
	mediaDir string,
	mediaURLPath string,
	seenLocalImages map[string]struct{},
	seenExternalImages map[string]struct{},
) {
	trimmedSource := strings.TrimSpace(rawSource)
	if trimmedSource == "" {
		return
	}

	profile.imageCount++

	if normalizedPath := normalizeReferencedMediaPath(trimmedSource, mediaURLPath); normalizedPath != "" && mediaDir != "" {
		if _, exists := seenLocalImages[normalizedPath]; exists {
			return
		}

		seenLocalImages[normalizedPath] = struct{}{}
		relativePath := strings.TrimLeft(strings.TrimPrefix(normalizedPath, mediaURLPath), "/")
		if relativePath == "" {
			return
		}

		if fileInfo, err := os.Stat(filepath.Join(mediaDir, filepath.FromSlash(relativePath))); err == nil {
			profile.localImageBytes += fileInfo.Size()
		}
		return
	}

	normalizedExternalSource := trimmedSource
	if strings.HasPrefix(normalizedExternalSource, "//") {
		normalizedExternalSource = "https:" + normalizedExternalSource
	}

	parsedURL, err := url.Parse(normalizedExternalSource)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return
	}

	if _, exists := seenExternalImages[normalizedExternalSource]; exists {
		return
	}

	seenExternalImages[normalizedExternalSource] = struct{}{}
	profile.externalImageCount++
}

func (profile pdfRenderProfile) shouldPreferLegacyRenderer() bool {
	if profile.shouldReject() {
		return false
	}

	return profile.htmlBytes > pdfChromiumHTMLByteLimit ||
		profile.imageCount > pdfChromiumImageCountLimit ||
		profile.externalImageCount > pdfChromiumExternalImageCountLimit ||
		profile.localImageBytes > pdfChromiumLocalImageByteLimit
}

func (profile pdfRenderProfile) shouldReject() bool {
	return profile.htmlBytes > pdfAbsoluteHTMLByteLimit ||
		profile.imageCount > pdfAbsoluteImageCountLimit ||
		profile.externalImageCount > pdfAbsoluteExternalImageCountLimit ||
		profile.localImageBytes > pdfAbsoluteLocalImageByteLimit
}

func normalizePDFBaseURL(value string) string {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return defaultPDFBaseURL
	}

	parsedURL, err := url.Parse(trimmedValue)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return defaultPDFBaseURL
	}

	return strings.TrimRight(parsedURL.String(), "/") + "/"
}

func pdfAccentCSSColor(value string) string {
	red, green, blue := parseAccentColor(value)
	return fmt.Sprintf("#%02x%02x%02x", red, green, blue)
}

func resolvePDFChromiumExecutable() (string, error) {
	if configuredPath := strings.TrimSpace(os.Getenv("BLOG_PDF_CHROMIUM_EXECUTABLE")); configuredPath != "" {
		if _, err := os.Stat(configuredPath); err == nil {
			return configuredPath, nil
		}

		return "", fmt.Errorf("configured chromium executable not found: %s", configuredPath)
	}

	for _, candidate := range pdfChromiumCandidates {
		if strings.Contains(candidate, string(os.PathSeparator)) {
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
			continue
		}

		resolvedPath, err := exec.LookPath(candidate)
		if err == nil {
			return resolvedPath, nil
		}
	}

	return "", fmt.Errorf("chromium executable not found; set BLOG_PDF_CHROMIUM_EXECUTABLE or install chromium")
}

func renderHTMLDocumentToPDF(documentHTML string) ([]byte, error) {
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		return nil, err
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("force-color-profile", "srgb"),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	defer cancelAllocator()

	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)
	defer cancelBrowser()

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 45*time.Second)
	defer cancelTimeout()

	var pdfBytes []byte
	err = chromedp.Run(timeoutContext,
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			if frameTree == nil || frameTree.Frame.ID == "" {
				return fmt.Errorf("failed to resolve chromium frame")
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-pdf-ready='true']", chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			data, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(true).
				WithMarginTop(0).
				WithMarginRight(0).
				WithMarginBottom(0).
				WithMarginLeft(0).
				Do(ctx)
			if err != nil {
				return err
			}

			pdfBytes = data
			return nil
		}),
	)
	if err != nil {
		return nil, err
	}

	if len(pdfBytes) == 0 {
		return nil, fmt.Errorf("chromium returned an empty pdf document")
	}

	return pdfBytes, nil
}

func resolvePDFFontPath() (string, error) {
	if configuredPath := strings.TrimSpace(os.Getenv("BLOG_PDF_FONT_PATH")); configuredPath != "" {
		if _, err := os.Stat(configuredPath); err == nil {
			return configuredPath, nil
		}
	}

	for _, candidate := range pdfFontCandidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("pdf font not found; set BLOG_PDF_FONT_PATH or install a supported font")
}

func loadPDFKaTeXAssets() pdfKaTeXAssets {
	pdfKaTeXAssetsOnce.Do(func() {
		cachedPDFKaTeXAssets = pdfKaTeXAssets{
			cssDataURL: loadPDFKaTeXAssetDataURL("katex.min.css", "text/css"),
			jsDataURL:  loadPDFKaTeXAssetDataURL("katex.min.js", "text/javascript"),
		}
	})

	return cachedPDFKaTeXAssets
}

func loadPDFKaTeXAssetDataURL(fileName string, mimeType string) string {
	for _, assetPath := range pdfKaTeXAssetPaths(fileName) {
		assetBytes, err := os.ReadFile(assetPath)
		if err != nil || len(assetBytes) == 0 {
			continue
		}

		return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(assetBytes)
	}

	return ""
}

func pdfKaTeXAssetPaths(fileName string) []string {
	if strings.TrimSpace(fileName) == "" {
		return nil
	}

	seenPaths := make(map[string]struct{})
	paths := make([]string, 0, len(pdfKaTeXAssetDirCandidates)+2)
	appendPath := func(path string) {
		cleanedPath := filepath.Clean(strings.TrimSpace(path))
		if cleanedPath == "" {
			return
		}

		if _, exists := seenPaths[cleanedPath]; exists {
			return
		}

		seenPaths[cleanedPath] = struct{}{}
		paths = append(paths, cleanedPath)
	}

	if configuredDir := strings.TrimSpace(os.Getenv("BLOG_PDF_KATEX_DIR")); configuredDir != "" {
		appendPath(filepath.Join(configuredDir, fileName))
	}

	if executablePath, err := os.Executable(); err == nil {
		executableDir := filepath.Dir(executablePath)
		appendPath(filepath.Join(executableDir, "..", "share", "blog-api", "pdf-assets", fileName))
	}

	for _, candidateDir := range pdfKaTeXAssetDirCandidates {
		appendPath(filepath.Join(candidateDir, fileName))
	}

	return paths
}

func renderPostBodyHTML(title string, body string, bodyFormat BodyFormat) (string, error) {
	normalizedTitle := normalizeWhitespace(title)
	var bodyHTML string

	if normalizeBodyFormat(bodyFormat) == BodyFormatHTML {
		bodyHTML = sanitizeBodyContent(body, BodyFormatHTML)
		return normalizePDFMathHTML(stripLeadingPDFTitleHeading(normalizedTitle, bodyHTML)), nil
	}

	var buffer bytes.Buffer
	if err := markdownToHTML.Convert([]byte(body), &buffer); err != nil {
		return "", err
	}

	bodyHTML = stripLeadingPDFTitleHeading(normalizedTitle, buffer.String())
	return normalizePDFMathHTML(bodyHTML), nil
}

func normalizePDFMathHTML(bodyHTML string) string {
	trimmedBodyHTML := strings.TrimSpace(bodyHTML)
	if trimmedBodyHTML == "" {
		return bodyHTML
	}

	document, err := htmlnode.Parse(strings.NewReader(trimmedBodyHTML))
	if err != nil {
		return bodyHTML
	}

	root := findFirstNodeByAtom(document, atom.Body)
	if root == nil {
		root = document
	}

	rewritePDFMathTextNodes(root, false)
	return renderNodeInnerHTML(root)
}

func rewritePDFMathTextNodes(node *htmlnode.Node, preserveRawText bool) {
	if node == nil {
		return
	}

	if node.Type == htmlnode.TextNode && !preserveRawText {
		rewritePDFMathTextNode(node)
		return
	}

	nextPreserveRawText := preserveRawText
	if node.Type == htmlnode.ElementNode {
		switch node.DataAtom {
		case atom.Code, atom.Pre, atom.Script, atom.Style:
			nextPreserveRawText = true
		}
	}

	for child := node.FirstChild; child != nil; {
		nextChild := child.NextSibling
		rewritePDFMathTextNodes(child, nextPreserveRawText)
		child = nextChild
	}
}

type pdfMathTextSegment struct {
	text       string
	expression string
	display    bool
	isMath     bool
}

func rewritePDFMathTextNode(node *htmlnode.Node) {
	if node == nil || node.Type != htmlnode.TextNode {
		return
	}

	if containsPDFMathSyntax(node.Data) {
		markPDFMathRenderNode(node)
		segments := splitPDFMathTextSegments(node.Data)
		if len(segments) == 0 {
			node.Data = normalizePDFTextNodeValue(node.Data)
			return
		}

		replacementNodes := make([]*htmlnode.Node, 0, len(segments))
		for _, segment := range segments {
			if segment.isMath {
				placeholderNode := newPDFMathPlaceholderNode(segment.expression, segment.display)
				if placeholderNode != nil {
					replacementNodes = append(replacementNodes, placeholderNode)
				}
				continue
			}

			normalizedText := normalizePDFTextNodeValue(segment.text)
			if normalizedText == "" {
				continue
			}

			replacementNodes = append(replacementNodes, &htmlnode.Node{Type: htmlnode.TextNode, Data: normalizedText})
		}

		for _, replacementNode := range replacementNodes {
			insertHTMLNodeBefore(node, replacementNode)
		}

		detachHTMLNode(node)
		return
	}

	if expression, display := extractStandalonePDFMathExpression(node); expression != "" {
		markPDFMathRenderNode(node)
		placeholderNode := newPDFMathPlaceholderNode(expression, display)
		if placeholderNode != nil {
			insertHTMLNodeBefore(node, placeholderNode)
			detachHTMLNode(node)
			return
		}
	}

	if containsRawPDFMathHint(node.Data) {
		markPDFMathRenderNode(node)
	}

	node.Data = normalizePDFTextNodeValue(node.Data)
}

func extractStandalonePDFMathExpression(node *htmlnode.Node) (string, bool) {
	if node == nil || node.Type != htmlnode.TextNode || node.Parent == nil || node.Parent.Type != htmlnode.ElementNode {
		return "", false
	}

	if !supportsStandalonePDFMath(node.Parent.DataAtom) {
		return "", false
	}

	for sibling := node.Parent.FirstChild; sibling != nil; sibling = sibling.NextSibling {
		if sibling == node {
			continue
		}

		if sibling.Type == htmlnode.TextNode && strings.TrimSpace(sibling.Data) == "" {
			continue
		}

		return "", false
	}

	trimmedText := normalizeWhitespace(node.Data)
	if !looksLikeStandalonePDFMathExpression(trimmedText) {
		return "", false
	}

	return trimmedText, node.Parent.DataAtom != atom.Span
}

func supportsStandalonePDFMath(tag atom.Atom) bool {
	switch tag {
	case atom.P, atom.Div, atom.Li, atom.Blockquote, atom.Td, atom.Th:
		return true
	default:
		return false
	}
}

func looksLikeStandalonePDFMathExpression(value string) bool {
	trimmedValue := normalizeWhitespace(value)
	if trimmedValue == "" {
		return false
	}

	for _, currentRune := range trimmedValue {
		if unicode.Is(unicode.Han, currentRune) {
			return false
		}
	}

	hasStrongMathMarker := strings.ContainsAny(trimmedValue, `\\_^{}=`)
	if !hasStrongMathMarker {
		hasStrongMathMarker = strings.Contains(trimmedValue, "=") && strings.Contains(trimmedValue, "(") && strings.Contains(trimmedValue, ")")
	}
	if !hasStrongMathMarker {
		return false
	}

	wordCount := len(strings.Fields(trimmedValue))
	if wordCount > 12 {
		return false
	}

	return true
}

func containsRawPDFMathHint(value string) bool {
	trimmedValue := normalizeWhitespace(value)
	if trimmedValue == "" {
		return false
	}

	return strings.Contains(trimmedValue, `\`)
}

func splitPDFMathTextSegments(value string) []pdfMathTextSegment {
	segments := make([]pdfMathTextSegment, 0, 4)
	remaining := value

	for remaining != "" {
		blockMatch := pdfBlockMathPattern.FindStringSubmatchIndex(remaining)
		inlineMatch := pdfInlineMathPattern.FindStringSubmatchIndex(remaining)

		match, display := chooseEarlierPDFMathMatch(blockMatch, inlineMatch)
		if match == nil {
			segments = append(segments, pdfMathTextSegment{text: remaining})
			break
		}

		if match[0] > 0 {
			segments = append(segments, pdfMathTextSegment{text: remaining[:match[0]]})
		}

		expression := strings.TrimSpace(extractPDFMathExpressionFromMatch(remaining, match))
		if expression != "" {
			segments = append(segments, pdfMathTextSegment{
				expression: expression,
				display:    display,
				isMath:     true,
			})
		}

		remaining = remaining[match[1]:]
	}

	return segments
}

func chooseEarlierPDFMathMatch(blockMatch []int, inlineMatch []int) ([]int, bool) {
	if len(blockMatch) == 0 {
		return inlineMatch, false
	}

	if len(inlineMatch) == 0 {
		return blockMatch, true
	}

	if blockMatch[0] <= inlineMatch[0] {
		return blockMatch, true
	}

	return inlineMatch, false
}

func extractPDFMathExpressionFromMatch(source string, match []int) string {
	if len(match) < 6 {
		return ""
	}

	for captureIndex := 4; captureIndex+1 < len(match); captureIndex += 2 {
		captureStart := match[captureIndex]
		captureEnd := match[captureIndex+1]
		if captureStart < 0 || captureEnd < 0 {
			continue
		}

		return source[captureStart:captureEnd]
	}

	return ""
}

func newPDFMathPlaceholderNode(expression string, display bool) *htmlnode.Node {
	trimmedExpression := strings.TrimSpace(expression)
	if trimmedExpression == "" {
		return nil
	}

	placeholderNode := &htmlnode.Node{
		Type:     htmlnode.ElementNode,
		DataAtom: atom.Span,
		Data:     atom.Span.String(),
		Attr: []htmlnode.Attribute{
			{Key: "class", Val: "pdf-math-fragment"},
			{Key: pdfMathExpressionAttrName, Val: trimmedExpression},
			{Key: pdfMathDisplayAttrName, Val: strconv.FormatBool(display)},
		},
	}

	fallbackText := strings.TrimSpace(renderPDFMathExpression(trimmedExpression))
	if fallbackText == "" {
		fallbackText = trimmedExpression
	}

	placeholderNode.AppendChild(&htmlnode.Node{Type: htmlnode.TextNode, Data: fallbackText})
	return placeholderNode
}

func insertHTMLNodeBefore(referenceNode *htmlnode.Node, newNode *htmlnode.Node) {
	if referenceNode == nil || newNode == nil || referenceNode.Parent == nil {
		return
	}

	parentNode := referenceNode.Parent
	newNode.Parent = parentNode
	newNode.NextSibling = referenceNode
	newNode.PrevSibling = referenceNode.PrevSibling

	if referenceNode.PrevSibling != nil {
		referenceNode.PrevSibling.NextSibling = newNode
	} else {
		parentNode.FirstChild = newNode
	}

	referenceNode.PrevSibling = newNode
}

func containsPDFMathSyntax(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}

	return pdfBlockMathPattern.MatchString(value) || pdfInlineMathPattern.MatchString(value)
}

func markPDFMathRenderNode(node *htmlnode.Node) {
	var tableCandidate *htmlnode.Node
	var listCandidate *htmlnode.Node
	var blockCandidate *htmlnode.Node

	for current := node.Parent; current != nil; current = current.Parent {
		if current.Type != htmlnode.ElementNode {
			continue
		}

		switch current.DataAtom {
		case atom.Pre, atom.Code, atom.Script, atom.Style:
			return
		case atom.Table:
			tableCandidate = current
		case atom.Li:
			if listCandidate == nil {
				listCandidate = current
			}
		case atom.Ul, atom.Ol:
			if listCandidate == nil {
				listCandidate = current
			}
		case atom.P, atom.Blockquote, atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6, atom.Div:
			if blockCandidate == nil {
				blockCandidate = current
			}
		}
	}

	if tableCandidate != nil {
		setPDFBrowserRenderAttr(tableCandidate, pdfBrowserRenderMathValue)
		return
	}

	if listCandidate != nil {
		setPDFBrowserRenderAttr(listCandidate, pdfBrowserRenderMathValue)
		return
	}

	if blockCandidate != nil {
		setPDFBrowserRenderAttr(blockCandidate, pdfBrowserRenderMathValue)
	}
}

func setPDFBrowserRenderAttr(node *htmlnode.Node, value string) {
	if node == nil || node.Type != htmlnode.ElementNode {
		return
	}

	for index, attribute := range node.Attr {
		if attribute.Key == pdfBrowserRenderAttrName {
			node.Attr[index].Val = value
			return
		}
	}

	node.Attr = append(node.Attr, htmlnode.Attribute{Key: pdfBrowserRenderAttrName, Val: value})
}

func hasPDFBrowserRenderAttr(node *htmlnode.Node, value string) bool {
	if node == nil || node.Type != htmlnode.ElementNode {
		return false
	}

	for _, attribute := range node.Attr {
		if attribute.Key == pdfBrowserRenderAttrName && attribute.Val == value {
			return true
		}
	}

	return false
}

func normalizePDFTextNodeValue(value string) string {
	if value == "" {
		return ""
	}

	normalizedValue := strings.ReplaceAll(value, "\u00a0", " ")
	normalizedValue = replacePDFBlockMath(normalizedValue)
	normalizedValue = replacePDFInlineMath(normalizedValue)
	return normalizedValue
}

func (r *pdfRenderer) renderHeader(document normalizedPDFExport) {
	red, green, blue := parseAccentColor(document.Accent)
	r.pdf.SetFillColor(red, green, blue)
	r.pdf.Rect(r.leftMargin, r.pdf.GetY(), r.contentWidth(0), 4, "F")
	r.pdf.Ln(9)

	r.pdf.SetTextColor(36, 24, 15)
	r.pdf.SetFont(r.fontFamily, "", 26)
	r.writeTextBlock(document.Title, 11.5, 0)

	if summary := normalizePDFSummary(document.Title, document.Summary); summary != "" {
		r.pdf.SetTextColor(98, 82, 68)
		r.pdf.SetFont(r.fontFamily, "", 16)
		r.writeTextBlock(summary, 7, 0)
	}

	metaParts := []string{}
	if document.Author != "" {
		metaParts = append(metaParts, document.Author)
	}
	if document.PublishedAt != "" {
		metaParts = append(metaParts, document.PublishedAt)
	}
	if document.Category != "" {
		metaParts = append(metaParts, document.Category)
	}
	if len(document.Tags) > 0 {
		metaParts = append(metaParts, strings.Join(document.Tags, " · "))
	}
	if len(metaParts) > 0 {
		r.pdf.SetFont(r.fontFamily, "", 10.5)
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(strings.Join(metaParts, "    "), 5.8, 0)
	}

	r.pdf.SetDrawColor(221, 212, 199)
	r.pdf.Line(r.leftMargin, r.pdf.GetY()+1, r.pageWidth-r.rightMargin, r.pdf.GetY()+1)
	r.pdf.Ln(8)
	r.pdf.SetTextColor(36, 24, 15)
}

func (r *pdfRenderer) renderBody(bodyHTML string) error {
	document, err := htmlnode.Parse(strings.NewReader(bodyHTML))
	if err != nil {
		return err
	}

	root := findFirstNodeByAtom(document, atom.Body)
	if root == nil {
		root = document
	}

	for child := root.FirstChild; child != nil; child = child.NextSibling {
		r.renderNode(child, 0)
	}

	return nil
}

func (r *pdfRenderer) close() {
	if r == nil || r.browser == nil {
		return
	}

	r.browser.close()
	r.browser = nil
}

func (r *pdfRenderer) ensureBrowserRenderer() (*pdfFragmentBrowserRenderer, error) {
	if r == nil {
		return nil, fmt.Errorf("pdf renderer is not initialized")
	}

	if r.browser != nil {
		return r.browser, nil
	}

	browserRenderer, err := newPDFFragmentBrowserRenderer()
	if err != nil {
		return nil, err
	}

	r.browser = browserRenderer
	return r.browser, nil
}

func (r *pdfRenderer) renderNode(node *htmlnode.Node, indentLevel int) {
	if node == nil {
		return
	}

	if node.Type == htmlnode.TextNode {
		text := normalizeWhitespace(node.Data)
		if text != "" {
			r.pdf.SetFont(r.fontFamily, "", 12)
			r.writeTextBlock(text, 6.8, indentLevel)
		}
		return
	}

	if node.Type != htmlnode.ElementNode {
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			r.renderNode(child, indentLevel)
		}
		return
	}

	if (hasPDFBrowserRenderAttr(node, pdfBrowserRenderMathValue) && node.DataAtom != atom.Li) || node.DataAtom == atom.Table {
		if r.renderBrowserHTMLNode(node, indentLevel) {
			return
		}
	}

	switch node.DataAtom {
	case atom.H1:
		r.renderHeading(extractNodeText(node), 22, indentLevel)
	case atom.H2:
		r.renderHeading(extractNodeText(node), 18, indentLevel)
	case atom.H3:
		r.renderHeading(extractNodeText(node), 15, indentLevel)
	case atom.H4, atom.H5, atom.H6:
		r.renderHeading(extractNodeText(node), 13, indentLevel)
	case atom.P:
		r.renderParagraph(node, indentLevel)
	case atom.Blockquote:
		r.pdf.SetTextColor(88, 97, 104)
		r.pdf.SetFont(r.fontFamily, "", 11.5)
		r.writeTextBlock(collectInlineText(node), 6.4, indentLevel+1)
		r.pdf.SetTextColor(36, 24, 15)
	case atom.Ul:
		r.renderList(node, false, indentLevel)
	case atom.Ol:
		r.renderList(node, true, indentLevel)
	case atom.Pre:
		r.renderCodeBlock(node, indentLevel)
	case atom.Figure:
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			r.renderNode(child, indentLevel)
		}
	case atom.Picture:
		r.renderPicture(node, indentLevel)
	case atom.Img:
		r.renderImage(node, indentLevel)
	case atom.Figcaption:
		r.pdf.SetFont(r.fontFamily, "", 10)
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(collectInlineText(node), 5.8, indentLevel)
		r.pdf.SetTextColor(36, 24, 15)
	case atom.Table:
		r.renderTable(node, indentLevel)
	case atom.Hr:
		r.pdf.SetDrawColor(221, 212, 199)
		r.pdf.Line(r.contentX(indentLevel), r.pdf.GetY()+1, r.contentX(indentLevel)+r.contentWidth(indentLevel), r.pdf.GetY()+1)
		r.pdf.Ln(4)
	case atom.Div, atom.Article, atom.Main, atom.Section, atom.Header, atom.Footer, atom.Tbody, atom.Thead:
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			r.renderNode(child, indentLevel)
		}
	case atom.Br:
		r.pdf.Ln(4)
	default:
		if text := extractNodeText(node); text != "" {
			r.pdf.SetFont(r.fontFamily, "", 12)
			r.writeTextBlock(text, 6.8, indentLevel)
			return
		}

		for child := node.FirstChild; child != nil; child = child.NextSibling {
			r.renderNode(child, indentLevel)
		}
	}
}

func (r *pdfRenderer) renderHeading(text string, fontSize float64, indentLevel int) {
	if text == "" {
		return
	}

	r.pdf.Ln(1.5)
	r.pdf.SetFont(r.fontFamily, "", fontSize)
	r.writeTextBlock(text, fontSize*0.42, indentLevel)
}

func (r *pdfRenderer) renderList(node *htmlnode.Node, ordered bool, indentLevel int) {
	itemIndex := 1
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != htmlnode.ElementNode || child.DataAtom != atom.Li {
			continue
		}

		currentItemIndex := itemIndex
		if ordered {
			itemIndex++
		}

		if hasPDFBrowserRenderAttr(child, pdfBrowserRenderMathValue) {
			if r.renderBrowserListItem(child, ordered, currentItemIndex, indentLevel) {
				continue
			}
		}

		prefix := "•"
		if ordered {
			prefix = fmt.Sprintf("%d.", currentItemIndex)
		}

		leadText := listItemLeadText(child)
		if leadText != "" {
			r.pdf.SetFont(r.fontFamily, "", 11.5)
			r.writeTextBlock(prefix+" "+leadText, 6.4, indentLevel)
		}

		for grandChild := child.FirstChild; grandChild != nil; grandChild = grandChild.NextSibling {
			if grandChild.Type == htmlnode.ElementNode && (grandChild.DataAtom == atom.Ul || grandChild.DataAtom == atom.Ol) {
				r.renderNode(grandChild, indentLevel+1)
			}
		}
	}
}

func (r *pdfRenderer) renderCodeBlock(node *htmlnode.Node, indentLevel int) {
	codeText := normalizeCodeBlockText(extractNodeRawText(node))
	if codeText == "" {
		return
	}

	x := r.contentX(indentLevel)
	width := r.contentWidth(indentLevel)
	r.pdf.SetFillColor(251, 247, 240)
	r.pdf.SetDrawColor(221, 212, 199)
	r.pdf.SetFont(r.fontFamily, "", 10.5)
	paddingX := 2.5
	lineHeight := 5.2
	verticalGap := 0.6
	wrappedLines := splitCodeBlockLines(r.pdf, codeText, width-(paddingX*2))
	if len(wrappedLines) == 0 {
		return
	}

	r.pdf.Ln(1)
	for _, line := range wrappedLines {
		requiredHeight := lineHeight + verticalGap + 0.8
		if r.remainingPageHeight() < requiredHeight {
			r.pdf.AddPage()
		}

		y := r.pdf.GetY()
		r.pdf.Rect(x, y, width, lineHeight+0.8, "F")
		r.pdf.SetXY(x+paddingX, y+0.35)
		r.pdf.CellFormat(width-(paddingX*2), lineHeight, preservePrintableCodeLine(line), "", 0, "L", false, 0, "")
		r.pdf.SetY(y + lineHeight + verticalGap)
	}

	r.pdf.Ln(1.4)
}

func (r *pdfRenderer) renderImage(node *htmlnode.Node, indentLevel int) {
	r.renderImageSource(htmlAttribute(node, "src"), htmlAttribute(node, "alt"), indentLevel)
}

func (r *pdfRenderer) renderPicture(node *htmlnode.Node, indentLevel int) {
	imageSource, imageAlt := pictureImageSource(node)
	r.renderImageSource(imageSource, imageAlt, indentLevel)
}

func (r *pdfRenderer) renderImageSource(imageSource string, imageAlt string, indentLevel int) {
	if imageSource == "" {
		return
	}

	asset, err := r.resolveImageAsset(imageSource)
	if err != nil || asset == nil {
		r.renderImageFallback(imageAlt, indentLevel)
		return
	}

	options := gofpdf.ImageOptions{ImageType: asset.imageType, ReadDpi: true}
	info := registerPDFImage(r.pdf, asset)
	if info == nil {
		r.renderImageFallback(imageAlt, indentLevel)
		return
	}

	imageWidth, imageHeight := info.Extent()
	if imageWidth <= 0 || imageHeight <= 0 {
		return
	}

	maxWidth := r.contentWidth(indentLevel)
	renderWidth := minFloat(imageWidth, maxWidth)
	renderHeight := imageHeight * renderWidth / imageWidth
	x := r.contentX(indentLevel)
	y := r.pdf.GetY()
	r.pdf.ImageOptions(asset.name, x, y, renderWidth, 0, false, options, 0, "")
	r.pdf.SetY(y + renderHeight + 2)

	if imageAlt != "" {
		r.pdf.SetFont(r.fontFamily, "", 10)
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(imageAlt, 5.6, indentLevel)
		r.pdf.SetTextColor(36, 24, 15)
	}
}

func (r *pdfRenderer) renderParagraph(node *htmlnode.Node, indentLevel int) {
	if node == nil {
		return
	}

	if !paragraphHasRenderableMedia(node) {
		r.pdf.SetFont(r.fontFamily, "", 12)
		r.writeTextBlock(collectInlineText(node), 6.8, indentLevel)
		return
	}

	fragments := make([]string, 0)
	flushText := func() {
		if len(fragments) == 0 {
			return
		}

		r.pdf.SetFont(r.fontFamily, "", 12)
		r.writeTextBlock(strings.Join(fragments, " "), 6.8, indentLevel)
		fragments = fragments[:0]
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if isRenderableMediaNode(child) {
			flushText()
			r.renderNode(child, indentLevel)
			continue
		}

		if text := collectInlineText(child); text != "" {
			fragments = append(fragments, text)
		}
	}

	flushText()
}

func (r *pdfRenderer) renderTable(node *htmlnode.Node, indentLevel int) {
	rows := extractPDFTableRows(node)
	if len(rows) == 0 {
		return
	}

	columnCount := maxPDFTableColumns(rows)
	if columnCount == 0 {
		return
	}

	const (
		tableFontSize  = 10.5
		cellLineHeight = 5.1
		cellPaddingX   = 2.2
		cellPaddingY   = 1.4
		tableBottomGap = 1.4
		tableSafetyGap = 0.8
	)

	tableX := r.contentX(indentLevel)
	columnWidth := r.contentWidth(indentLevel) / float64(columnCount)
	r.pdf.Ln(1)
	r.pdf.SetFont(r.fontFamily, "", tableFontSize)
	r.pdf.SetDrawColor(221, 212, 199)
	r.pdf.SetTextColor(36, 24, 15)
	for _, row := range rows {
		cells := normalizePDFTableRowCells(row, columnCount)
		rowHeight := pdfTableRowHeight(r.pdf, cells, columnWidth, cellPaddingX, cellPaddingY, cellLineHeight)
		if rowHeight <= 0 {
			continue
		}

		if r.remainingPageHeight() < rowHeight+tableSafetyGap {
			r.pdf.AddPage()
		}

		rowY := r.pdf.GetY()
		for cellIndex, cell := range cells {
			cellX := tableX + float64(cellIndex)*columnWidth
			fillStyle := "D"
			if cell.isHeader {
				r.pdf.SetFillColor(245, 239, 229)
				fillStyle = "FD"
			}

			r.pdf.Rect(cellX, rowY, columnWidth, rowHeight, fillStyle)
			r.pdf.SetXY(cellX+cellPaddingX, rowY+cellPaddingY)
			r.pdf.MultiCell(columnWidth-(cellPaddingX*2), cellLineHeight, preservePrintablePDFTableCellText(cell.text), "", "L", false)
			r.pdf.SetXY(cellX+columnWidth, rowY)
		}

		r.pdf.SetY(rowY + rowHeight)
	}

	r.pdf.Ln(tableBottomGap)
}

func (r *pdfRenderer) renderBrowserHTMLNode(node *htmlnode.Node, indentLevel int) bool {
	return r.renderBrowserHTMLFragment(renderSingleNodeHTML(node), indentLevel)
}

func (r *pdfRenderer) renderBrowserListItem(node *htmlnode.Node, ordered bool, itemIndex int, indentLevel int) bool {
	listItemHTML := renderSingleNodeHTML(node)
	if listItemHTML == "" {
		return false
	}

	listHTML := fmt.Sprintf("<ul>%s</ul>", listItemHTML)
	if ordered {
		listHTML = fmt.Sprintf("<ol start=\"%d\">%s</ol>", itemIndex, listItemHTML)
	}

	return r.renderBrowserHTMLFragment(listHTML, indentLevel)
}

func (r *pdfRenderer) renderBrowserHTMLFragment(fragmentHTML string, indentLevel int) bool {
	trimmedFragmentHTML := strings.TrimSpace(fragmentHTML)
	if trimmedFragmentHTML == "" {
		return false
	}

	browserRenderer, err := r.ensureBrowserRenderer()
	if err != nil {
		return false
	}

	pngBytes, err := browserRenderer.rasterize(trimmedFragmentHTML, r.contentWidth(indentLevel))
	if err != nil || len(pngBytes) == 0 {
		return false
	}

	assetKey := sha256.Sum256([]byte(trimmedFragmentHTML))
	asset := &pdfImageAsset{
		name:      fmt.Sprintf("pdf-browser-%x.png", assetKey[:8]),
		data:      pngBytes,
		imageType: "PNG",
	}

	info := registerPDFImage(r.pdf, asset)
	if info == nil {
		return false
	}

	imageWidth, imageHeight := info.Extent()
	if imageWidth <= 0 || imageHeight <= 0 {
		return false
	}

	maxWidth := r.contentWidth(indentLevel)
	renderWidth := minFloat(imageWidth, maxWidth)
	renderHeight := imageHeight * renderWidth / imageWidth
	x := r.contentX(indentLevel)
	y := r.pdf.GetY()
	r.pdf.ImageOptions(asset.name, x, y, renderWidth, 0, false, gofpdf.ImageOptions{ImageType: asset.imageType, ReadDpi: true}, 0, "")
	r.pdf.SetY(y + renderHeight + 1.6)
	return true
}

func renderSingleNodeHTML(node *htmlnode.Node) string {
	if node == nil {
		return ""
	}

	var buffer bytes.Buffer
	if err := htmlnode.Render(&buffer, node); err != nil {
		return ""
	}

	return buffer.String()
}

func buildPDFFragmentDocumentHTML(fragmentHTML string, viewportWidth int, contentWidthPx int, assets pdfKaTeXAssets) string {
	katexStylesheet := ""
	if assets.cssDataURL != "" {
		katexStylesheet = fmt.Sprintf("  <link rel=\"stylesheet\" href=\"%s\" />\n", template.HTMLEscapeString(assets.cssDataURL))
	}

	katexScript := ""
	if assets.jsDataURL != "" {
		katexScript = fmt.Sprintf("  <script defer src=\"%s\"></script>\n", template.HTMLEscapeString(assets.jsDataURL))
	}

	return fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
%s  <style>
		:root {
			color-scheme: light;
			--ink: #24180f;
			--muted: #625244;
		}

		* {
			box-sizing: border-box;
		}

		html, body {
			margin: 0;
			padding: 0;
			background: transparent;
			color: var(--ink);
			font-family: "Droid Sans Fallback", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
			-webkit-font-smoothing: antialiased;
		}

		body {
			width: %dpx;
			padding: 0;
		}

		#pdf-fragment {
			width: %dpx;
			display: block;
		}

		#pdf-fragment,
		#pdf-fragment * {
			overflow-wrap: anywhere;
		}

		#pdf-fragment h1,
		#pdf-fragment h2,
		#pdf-fragment h3,
		#pdf-fragment h4,
		#pdf-fragment h5,
		#pdf-fragment h6 {
			margin: 0;
			color: var(--ink);
			line-height: 1.25;
		}

		#pdf-fragment h1 { font-size: 30px; }
		#pdf-fragment h2 { font-size: 24px; }
		#pdf-fragment h3 { font-size: 20px; }
		#pdf-fragment h4,
		#pdf-fragment h5,
		#pdf-fragment h6 { font-size: 18px; }

		#pdf-fragment p,
		#pdf-fragment li,
		#pdf-fragment blockquote,
		#pdf-fragment td,
		#pdf-fragment th,
		#pdf-fragment code {
			margin: 0;
			font-size: 14px;
			line-height: 1.9;
			color: rgba(36, 24, 15, 0.88);
			white-space: pre-wrap;
		}

		#pdf-fragment ul,
		#pdf-fragment ol {
			margin: 0;
			padding-left: 1.35rem;
		}

		#pdf-fragment blockquote {
			border-left: 3px solid rgba(15, 118, 110, 0.35);
			background: rgba(15, 118, 110, 0.07);
			border-radius: 0 1rem 1rem 0;
			padding: 0.95rem 1.1rem;
		}

		#pdf-fragment table {
			width: 100%%;
			border-collapse: collapse;
			table-layout: fixed;
		}

		#pdf-fragment th,
		#pdf-fragment td {
			border-bottom: 1px solid rgba(36, 24, 15, 0.12);
			padding: 0.65rem 0.75rem;
			text-align: left;
			vertical-align: top;
		}

		#pdf-fragment img {
			max-width: 100%%;
			display: block;
		}

		#pdf-fragment .pdf-math-fragment[data-pdf-math-display="true"] {
			display: block;
			margin: 0.55rem 0;
		}

		#pdf-fragment .pdf-math-fragment[data-pdf-math-display="false"] {
			display: inline-block;
			vertical-align: middle;
		}
	</style>
%s  <script>
		window.addEventListener("load", function () {
			var isASCIIOnlyMathCandidate = function (expression) {
				return !(/[^\x00-\x7F]/).test(expression);
			};

			var canAttemptRawMathRender = function (node) {
				if (!node || node.querySelector("[data-pdf-math-expression]")) {
					return false;
				}

				if (node.children && node.children.length > 0) {
					return false;
				}

				var expression = (node.textContent || "").replace(/\u00a0/g, " ").trim();
				return expression.indexOf("\\") >= 0 && isASCIIOnlyMathCandidate(expression);
			};

			var renderRawMathNodes = function () {
				document.querySelectorAll('[data-pdf-browser="math"]').forEach(function (node) {
					if (!canAttemptRawMathRender(node)) {
						return;
					}

					var originalText = (node.textContent || "").replace(/\u00a0/g, " ").trim();
					if (!originalText) {
						return;
					}

					var displayMode = node.tagName !== "SPAN";
					try {
						window.katex.render(originalText, node, { displayMode: displayMode, throwOnError: true });
					} catch (error) {
						node.textContent = originalText;
					}
				});
			};

			var renderMath = function () {
				if (!window.katex) {
					document.body.dataset.ready = "true";
					return;
				}

				document.querySelectorAll("[data-pdf-math-expression]").forEach(function (node) {
					var expression = node.getAttribute("data-pdf-math-expression") || "";
					var displayMode = node.getAttribute("data-pdf-math-display") === "true";

					if (!expression) {
						return;
					}

					try {
						window.katex.render(expression, node, { displayMode: displayMode, throwOnError: false });
					} catch (error) {
						node.textContent = node.textContent || expression;
					}
				});

					renderRawMathNodes();

				document.body.dataset.ready = "true";
			};

			var done = function () {
				window.requestAnimationFrame(function () {
					renderMath();
				});
			};

			if (document.fonts && document.fonts.ready) {
				document.fonts.ready.then(done, done);
				return;
			}
			done();
		});
	</script>
</head>
<body data-ready="loading">
	<div id="pdf-fragment">%s</div>
</body>
</html>`, katexStylesheet, viewportWidth, contentWidthPx, katexScript, fragmentHTML)
}

func newPDFFragmentBrowserRenderer() (*pdfFragmentBrowserRenderer, error) {
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		return nil, err
	}

	allocatorOptions := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(executablePath),
		chromedp.Headless,
		chromedp.DisableGPU,
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("force-color-profile", "srgb"),
	)

	allocatorContext, cancelAllocator := chromedp.NewExecAllocator(context.Background(), allocatorOptions...)
	browserContext, cancelBrowser := chromedp.NewContext(allocatorContext)

	return &pdfFragmentBrowserRenderer{
		assets:          loadPDFKaTeXAssets(),
		allocatorCtx:    allocatorContext,
		cancelAllocator: cancelAllocator,
		browserCtx:      browserContext,
		cancelBrowser:   cancelBrowser,
	}, nil
}

func (r *pdfFragmentBrowserRenderer) close() {
	if r == nil {
		return
	}

	if r.cancelBrowser != nil {
		r.cancelBrowser()
		r.cancelBrowser = nil
	}

	if r.cancelAllocator != nil {
		r.cancelAllocator()
		r.cancelAllocator = nil
	}
}

func (r *pdfFragmentBrowserRenderer) rasterize(fragmentHTML string, contentWidthMM float64) ([]byte, error) {
	if r == nil {
		return nil, fmt.Errorf("pdf fragment browser renderer is not initialized")
	}

	contentWidthPx := int(contentWidthMM*4.4 + 0.5)
	if contentWidthPx < 360 {
		contentWidthPx = 360
	}

	viewportWidth := contentWidthPx + 48
	documentHTML := buildPDFFragmentDocumentHTML(fragmentHTML, viewportWidth, contentWidthPx, r.assets)

	timeoutContext, cancelTimeout := context.WithTimeout(r.browserCtx, 20*time.Second)
	defer cancelTimeout()

	var pngBytes []byte
	err := chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(int64(viewportWidth), 2048),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			frameTree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}

			if frameTree == nil || frameTree.Frame.ID == "" {
				return fmt.Errorf("failed to resolve chromium frame")
			}

			return page.SetDocumentContent(frameTree.Frame.ID, documentHTML).Do(ctx)
		}),
		chromedp.WaitReady("body[data-ready='true']", chromedp.ByQuery),
		chromedp.Screenshot("#pdf-fragment", &pngBytes, chromedp.ByQuery),
	)
	if err != nil {
		return nil, err
	}

	if len(pngBytes) == 0 {
		return nil, fmt.Errorf("chromium returned an empty fragment screenshot")
	}

	return pngBytes, nil
}

func (r *pdfRenderer) writeTextBlock(text string, lineHeight float64, indentLevel int) {
	normalizedText := normalizePDFText(strings.TrimSpace(text))
	if normalizedText == "" {
		return
	}

	r.pdf.SetX(r.contentX(indentLevel))
	r.pdf.MultiCell(r.contentWidth(indentLevel), lineHeight, normalizedText, "", "L", false)
	r.pdf.Ln(1.6)
}

func (r *pdfRenderer) contentX(indentLevel int) float64 {
	return r.leftMargin + float64(indentLevel)*6
}

func (r *pdfRenderer) contentWidth(indentLevel int) float64 {
	width := r.pageWidth - r.leftMargin - r.rightMargin - float64(indentLevel)*6
	if width < 40 {
		return 40
	}

	return width
}

func (r *pdfRenderer) remainingPageHeight() float64 {
	_, pageHeight := r.pdf.GetPageSize()
	_, _, _, bottomMargin := r.pdf.GetMargins()
	return pageHeight - bottomMargin - r.pdf.GetY()
}

func normalizePDFSummary(title string, summary string) string {
	normalizedSummary := normalizeWhitespace(summary)
	if normalizedSummary == "" {
		return ""
	}

	normalizedTitle := normalizeWhitespace(title)
	if normalizedTitle == "" {
		return normalizedSummary
	}

	if normalizedSummary == normalizedTitle {
		return ""
	}

	if strings.HasPrefix(normalizedSummary, normalizedTitle) {
		trimmedSummary := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(normalizedSummary, normalizedTitle), " :：-—–,.，。;；、|/"))
		if trimmedSummary != "" {
			return trimmedSummary
		}
	}

	return normalizedSummary
}

func stripLeadingPDFTitleHeading(title string, bodyHTML string) string {
	if title == "" || strings.TrimSpace(bodyHTML) == "" {
		return bodyHTML
	}

	document, err := htmlnode.Parse(strings.NewReader(bodyHTML))
	if err != nil {
		return bodyHTML
	}

	root := findFirstNodeByAtom(document, atom.Body)
	if root == nil {
		root = document
	}

	firstNode := firstMeaningfulHTMLChild(root)
	if firstNode == nil || firstNode.Type != htmlnode.ElementNode || firstNode.DataAtom != atom.H1 {
		return bodyHTML
	}

	if normalizeWhitespace(extractNodeText(firstNode)) != title {
		return bodyHTML
	}

	detachHTMLNode(firstNode)
	return renderNodeInnerHTML(root)
}

func firstMeaningfulHTMLChild(root *htmlnode.Node) *htmlnode.Node {
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == htmlnode.CommentNode {
			continue
		}

		if child.Type == htmlnode.TextNode && strings.TrimSpace(child.Data) == "" {
			continue
		}

		return child
	}

	return nil
}

func collectInlineText(node *htmlnode.Node) string {
	if node == nil {
		return ""
	}

	var builder strings.Builder
	var walk func(*htmlnode.Node)
	walk = func(current *htmlnode.Node) {
		if current == nil {
			return
		}

		if current.Type == htmlnode.TextNode {
			builder.WriteString(current.Data)
			builder.WriteByte(' ')
			return
		}

		if current.Type == htmlnode.ElementNode {
			switch current.DataAtom {
			case atom.Br:
				builder.WriteByte('\n')
				return
			case atom.Img:
				if alt := strings.TrimSpace(htmlAttribute(current, "alt")); alt != "" {
					builder.WriteString(alt)
					builder.WriteByte(' ')
				}
				return
			}
		}

		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}

		if current.Type == htmlnode.ElementNode && current.DataAtom == atom.A {
			if href := strings.TrimSpace(htmlAttribute(current, "href")); href != "" {
				builder.WriteString("(")
				builder.WriteString(href)
				builder.WriteString(") ")
			}
		}
	}

	walk(node)
	return normalizeInlineText(builder.String())
}

func isRenderableMediaNode(node *htmlnode.Node) bool {
	if node == nil || node.Type != htmlnode.ElementNode {
		return false
	}

	return node.DataAtom == atom.Img || node.DataAtom == atom.Picture
}

func paragraphHasRenderableMedia(node *htmlnode.Node) bool {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if isRenderableMediaNode(child) {
			return true
		}
	}

	return false
}

func pictureImageSource(node *htmlnode.Node) (string, string) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != htmlnode.ElementNode {
			continue
		}

		if child.DataAtom == atom.Img {
			return htmlAttribute(child, "src"), htmlAttribute(child, "alt")
		}

		if child.DataAtom == atom.Source {
			source := firstSourceSetURL(htmlAttribute(child, "srcset"))
			if source != "" {
				return source, htmlAttribute(child, "alt")
			}
		}
	}

	return "", ""
}

func firstSourceSetURL(srcSet string) string {
	for _, candidate := range strings.Split(srcSet, ",") {
		trimmedCandidate := strings.TrimSpace(candidate)
		if trimmedCandidate == "" {
			continue
		}

		parts := strings.Fields(trimmedCandidate)
		if len(parts) > 0 {
			return parts[0]
		}
	}

	return ""
}

func (r *pdfRenderer) renderImageFallback(imageAlt string, indentLevel int) {
	fallbackText := strings.TrimSpace(imageAlt)
	if fallbackText == "" {
		fallbackText = "图片未嵌入 PDF"
	}

	r.pdf.SetFont(r.fontFamily, "", 10.5)
	r.pdf.SetTextColor(98, 82, 68)
	r.writeTextBlock(fallbackText, 5.8, indentLevel)
	r.pdf.SetTextColor(36, 24, 15)
}

func listItemLeadText(node *htmlnode.Node) string {
	parts := make([]string, 0)
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == htmlnode.ElementNode && (child.DataAtom == atom.Ul || child.DataAtom == atom.Ol) {
			continue
		}

		text := collectInlineText(child)
		if text != "" {
			parts = append(parts, text)
		}
	}

	return normalizeInlineText(strings.Join(parts, " "))
}

func extractNodeRawText(node *htmlnode.Node) string {
	if node == nil {
		return ""
	}

	var builder strings.Builder
	var walk func(*htmlnode.Node)
	walk = func(current *htmlnode.Node) {
		if current == nil {
			return
		}

		if current.Type == htmlnode.TextNode {
			builder.WriteString(current.Data)
		}

		if current.Type == htmlnode.ElementNode && current.DataAtom == atom.Br {
			builder.WriteByte('\n')
		}

		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}

		if current.Type == htmlnode.ElementNode {
			switch current.DataAtom {
			case atom.P, atom.Div, atom.Pre, atom.Li, atom.Tr:
				builder.WriteByte('\n')
			}
		}
	}

	walk(node)
	return strings.TrimSpace(strings.ReplaceAll(builder.String(), "\r", ""))
}

func extractPDFTableRows(node *htmlnode.Node) []pdfTableRow {
	rows := make([]pdfTableRow, 0)
	var walk func(*htmlnode.Node)
	walk = func(current *htmlnode.Node) {
		if current == nil {
			return
		}

		if current.Type == htmlnode.ElementNode && current.DataAtom == atom.Tr {
			cells := make([]pdfTableCell, 0)
			for child := current.FirstChild; child != nil; child = child.NextSibling {
				if child.Type != htmlnode.ElementNode {
					continue
				}
				if child.DataAtom != atom.Th && child.DataAtom != atom.Td {
					continue
				}

				text := collectInlineText(child)
				if text == "" {
					text = " "
				}
				cells = append(cells, pdfTableCell{text: text, isHeader: child.DataAtom == atom.Th})
			}

			if len(cells) > 0 {
				rows = append(rows, pdfTableRow{cells: cells})
			}
		}

		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}

	walk(node)
	return rows
}

func maxPDFTableColumns(rows []pdfTableRow) int {
	maxColumns := 0
	for _, row := range rows {
		if len(row.cells) > maxColumns {
			maxColumns = len(row.cells)
		}
	}

	return maxColumns
}

func normalizePDFTableRowCells(row pdfTableRow, columnCount int) []pdfTableCell {
	if columnCount <= 0 {
		return nil
	}

	normalizedCells := make([]pdfTableCell, columnCount)
	copy(normalizedCells, row.cells)
	for cellIndex := len(row.cells); cellIndex < columnCount; cellIndex++ {
		normalizedCells[cellIndex] = pdfTableCell{text: " "}
	}

	return normalizedCells
}

func pdfTableRowHeight(pdf *gofpdf.Fpdf, cells []pdfTableCell, columnWidth float64, paddingX float64, paddingY float64, lineHeight float64) float64 {
	if pdf == nil || len(cells) == 0 {
		return 0
	}

	textWidth := columnWidth - (paddingX * 2)
	if textWidth <= 0 {
		textWidth = columnWidth
	}

	maxLineCount := 1
	for _, cell := range cells {
		segments := pdf.SplitText(preservePrintablePDFTableCellText(cell.text), textWidth)
		if len(segments) > maxLineCount {
			maxLineCount = len(segments)
		}
	}

	return float64(maxLineCount)*lineHeight + (paddingY * 2)
}

func preservePrintablePDFTableCellText(value string) string {
	trimmedValue := strings.TrimSpace(strings.ReplaceAll(value, string(rune(0)), ""))
	if trimmedValue == "" {
		return " "
	}

	return trimmedValue
}

func parseAccentColor(value string) (int, int, int) {
	defaultColor := [3]int{15, 118, 110}
	match := pdfAccentHexPattern.FindString(value)
	if match == "" {
		return defaultColor[0], defaultColor[1], defaultColor[2]
	}

	hexValue := strings.TrimPrefix(match, "#")
	if len(hexValue) == 3 {
		hexValue = strings.Repeat(string(hexValue[0]), 2) + strings.Repeat(string(hexValue[1]), 2) + strings.Repeat(string(hexValue[2]), 2)
	}
	if len(hexValue) != 6 {
		return defaultColor[0], defaultColor[1], defaultColor[2]
	}

	var rgb [3]int
	for index := 0; index < 3; index++ {
		value, err := parseHexByte(hexValue[index*2 : index*2+2])
		if err != nil {
			return defaultColor[0], defaultColor[1], defaultColor[2]
		}
		rgb[index] = value
	}

	return rgb[0], rgb[1], rgb[2]
}

func parseHexByte(value string) (int, error) {
	parsed, err := strconv.ParseUint(value, 16, 8)
	if err != nil {
		return 0, err
	}

	return int(parsed), nil
}

func buildPDFFileName(title string) string {
	slug := normalizeSlug("", title)
	if slug == "" {
		slug = "post-" + time.Now().UTC().Format("20060102-150405")
	}

	return slug + ".pdf"
}

func pdfContentDisposition(fileName string) string {
	escapedName := url.PathEscape(fileName)
	return fmt.Sprintf("attachment; filename=%q; filename*=UTF-8''%s", fileName, escapedName)
}

func htmlAttribute(node *htmlnode.Node, key string) string {
	for _, attribute := range node.Attr {
		if strings.EqualFold(attribute.Key, key) {
			return attribute.Val
		}
	}

	return ""
}

func normalizeInlineText(value string) string {
	lines := strings.Split(strings.ReplaceAll(value, "\r", ""), "\n")
	normalizedLines := make([]string, 0, len(lines))
	for _, line := range lines {
		normalizedLine := normalizeWhitespace(line)
		if normalizedLine == "" {
			continue
		}
		normalizedLines = append(normalizedLines, normalizedLine)
	}

	return strings.Join(normalizedLines, "\n")
}

func normalizePDFText(value string) string {
	normalizedValue := strings.TrimSpace(strings.ReplaceAll(value, "\u00a0", " "))
	if normalizedValue == "" {
		return ""
	}

	normalizedValue = replacePDFBlockMath(normalizedValue)
	normalizedValue = replacePDFInlineMath(normalizedValue)
	return normalizedValue
}

func replacePDFBlockMath(value string) string {
	return pdfBlockMathPattern.ReplaceAllStringFunc(value, func(match string) string {
		expression := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "$$"), "$$"))
		if strings.HasPrefix(match, `\[`) && strings.HasSuffix(match, `\]`) {
			expression = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, `\[`), `\]`))
		}

		return renderPDFMathExpression(expression)
	})
}

func replacePDFInlineMath(value string) string {
	return pdfInlineMathPattern.ReplaceAllStringFunc(value, func(match string) string {
		expression := strings.TrimSpace(match)
		switch {
		case strings.HasPrefix(expression, `\(`) && strings.HasSuffix(expression, `\)`):
			expression = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(expression, `\(`), `\)`))
		case strings.HasPrefix(expression, "$") && strings.HasSuffix(expression, "$"):
			expression = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(expression, "$"), "$"))
		}

		if !looksLikePDFMathExpression(expression) {
			return match
		}

		return renderPDFMathExpression(expression)
	})
}

func looksLikePDFMathExpression(expression string) bool {
	trimmedExpression := strings.TrimSpace(expression)
	if trimmedExpression == "" {
		return false
	}

	if strings.ContainsAny(trimmedExpression, `\\^_=+-*/()[]<>`) {
		return true
	}

	return len([]rune(trimmedExpression)) <= 8
}

func renderPDFMathExpression(expression string) string {
	normalizedExpression := strings.TrimSpace(strings.ReplaceAll(expression, "\r", ""))
	if normalizedExpression == "" {
		return ""
	}

	for {
		previousExpression := normalizedExpression
		normalizedExpression = pdfLatexFractionPattern.ReplaceAllString(normalizedExpression, "($1)/($2)")
		normalizedExpression = pdfLatexSqrtPattern.ReplaceAllString(normalizedExpression, "√($1)")
		normalizedExpression = pdfLatexTextPattern.ReplaceAllString(normalizedExpression, "$1")
		if normalizedExpression == previousExpression {
			break
		}
	}

	normalizedExpression = pdfLaTeXSymbolReplacer.Replace(normalizedExpression)
	normalizedExpression = strings.NewReplacer("{", "", "}", "").Replace(normalizedExpression)
	return normalizeWhitespace(normalizedExpression)
}

func normalizeCodeBlockText(value string) string {
	normalizedValue := strings.ReplaceAll(strings.ReplaceAll(value, "\r", ""), "\u00a0", " ")
	normalizedValue = strings.Trim(normalizedValue, "\n")
	if normalizedValue == "" {
		return ""
	}

	lines := strings.Split(normalizedValue, "\n")
	for index, line := range lines {
		lines[index] = expandCodeTabs(line, 4)
	}

	return strings.Join(lines, "\n")
}

func expandCodeTabs(value string, tabWidth int) string {
	if !strings.Contains(value, "\t") || tabWidth <= 0 {
		return value
	}

	var builder strings.Builder
	column := 0
	for _, currentRune := range value {
		if currentRune != '\t' {
			builder.WriteRune(currentRune)
			column++
			continue
		}

		padding := tabWidth - (column % tabWidth)
		if padding == 0 {
			padding = tabWidth
		}
		builder.WriteString(strings.Repeat(" ", padding))
		column += padding
	}

	return builder.String()
}

func splitCodeBlockLines(pdf *gofpdf.Fpdf, code string, width float64) []string {
	if pdf == nil {
		return nil
	}

	logicalLines := strings.Split(code, "\n")
	wrappedLines := make([]string, 0, len(logicalLines))
	for _, line := range logicalLines {
		segments := pdf.SplitText(line, width)
		if len(segments) == 0 {
			wrappedLines = append(wrappedLines, "")
			continue
		}

		wrappedLines = append(wrappedLines, segments...)
	}

	return wrappedLines
}

func preservePrintableCodeLine(line string) string {
	if line == "" {
		return " "
	}

	return strings.ReplaceAll(line, string(rune(0)), "")
}

func codeBlockHeightEstimate(code string, width float64) float64 {
	lineCount := strings.Count(code, "\n") + 1
	averageWrappedLines := maxFloat(1, float64(len([]rune(code)))/(width*1.5))
	return maxFloat(12, float64(lineCount)*5.2+averageWrappedLines*2+4)
}

func minFloat(left float64, right float64) float64 {
	if left < right {
		return left
	}

	return right
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}

	return right
}
