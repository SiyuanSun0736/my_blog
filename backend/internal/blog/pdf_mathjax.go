package blog

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/phpdave11/gofpdf"
	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type pdfMathRenderer struct {
	executablePath string
	scriptPath     string
	mathJaxDir     string

	mu    sync.Mutex
	cache map[string]*pdfImageAsset
}

type pdfMathRenderResponse struct {
	PNG   string `json:"png"`
	Error string `json:"error"`
}

type pdfMathPlaceholder struct {
	expression string
	display    bool
	format     string
}

var (
	pdfNodeCandidates = []string{
		"node",
		"/usr/bin/node",
		"/usr/local/bin/node",
	}
	pdfMathJaxDirCandidates = []string{
		"/usr/local/share/blog-api/pdf-mathjax/node_modules",
		"backend/node_modules",
		"node_modules",
		"../../node_modules",
		"../../../node_modules",
	}
	pdfMathJaxScriptCandidates = []string{
		"/usr/local/share/blog-api/pdf-mathjax/pdf_mathjax_renderer.cjs",
		"backend/internal/blog/pdf_mathjax_renderer.cjs",
		"internal/blog/pdf_mathjax_renderer.cjs",
		"pdf_mathjax_renderer.cjs",
	}
)

func resolvePDFNodeExecutable() (string, error) {
	if configuredPath := strings.TrimSpace(os.Getenv("BLOG_PDF_NODE_EXECUTABLE")); configuredPath != "" {
		if _, err := os.Stat(configuredPath); err == nil {
			return configuredPath, nil
		}

		return "", fmt.Errorf("configured node executable not found: %s", configuredPath)
	}

	for _, candidate := range pdfNodeCandidates {
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

	return "", fmt.Errorf("node executable not found; set BLOG_PDF_NODE_EXECUTABLE or install nodejs")
}

func resolvePDFMathJaxDir() (string, error) {
	if configuredDir := strings.TrimSpace(os.Getenv("BLOG_PDF_MATHJAX_DIR")); configuredDir != "" {
		if hasPDFMathRuntimePackages(configuredDir) {
			return filepath.Clean(configuredDir), nil
		}

		return "", fmt.Errorf("configured MathJax runtime directory is missing required packages: %s", configuredDir)
	}

	if executablePath, err := os.Executable(); err == nil {
		executableDir := filepath.Dir(executablePath)
		candidate := filepath.Join(executableDir, "..", "share", "blog-api", "pdf-mathjax", "node_modules")
		if hasPDFMathRuntimePackages(candidate) {
			return filepath.Clean(candidate), nil
		}
	}

	for _, candidateDir := range pdfMathJaxDirCandidates {
		if hasPDFMathRuntimePackages(candidateDir) {
			return filepath.Clean(candidateDir), nil
		}
	}

	return "", fmt.Errorf("MathJax runtime packages not found; set BLOG_PDF_MATHJAX_DIR or install backend npm dependencies")
}

func hasPDFMathRuntimePackages(dir string) bool {
	trimmedDir := strings.TrimSpace(dir)
	if trimmedDir == "" {
		return false
	}

	mathJaxPath := filepath.Join(trimmedDir, "mathjax-full", "js", "mathjax.js")
	if fileInfo, err := os.Stat(mathJaxPath); err != nil || fileInfo.IsDir() {
		return false
	}

	resvgPath := filepath.Join(trimmedDir, "@resvg", "resvg-js", "package.json")
	if fileInfo, err := os.Stat(resvgPath); err == nil && !fileInfo.IsDir() {
		return true
	}

	return false
}

func resolvePDFMathJaxScriptPath() (string, error) {
	if configuredPath := strings.TrimSpace(os.Getenv("BLOG_PDF_MATHJAX_RENDERER")); configuredPath != "" {
		if fileInfo, err := os.Stat(configuredPath); err == nil && !fileInfo.IsDir() {
			return filepath.Clean(configuredPath), nil
		}

		return "", fmt.Errorf("configured MathJax renderer script not found: %s", configuredPath)
	}

	if executablePath, err := os.Executable(); err == nil {
		executableDir := filepath.Dir(executablePath)
		candidate := filepath.Join(executableDir, "..", "share", "blog-api", "pdf-mathjax", "pdf_mathjax_renderer.cjs")
		if fileInfo, err := os.Stat(candidate); err == nil && !fileInfo.IsDir() {
			return filepath.Clean(candidate), nil
		}
	}

	for _, candidatePath := range pdfMathJaxScriptCandidates {
		if fileInfo, err := os.Stat(candidatePath); err == nil && !fileInfo.IsDir() {
			return filepath.Clean(candidatePath), nil
		}
	}

	return "", fmt.Errorf("MathJax renderer script not found")
}

func newPDFMathRenderer() (*pdfMathRenderer, error) {
	executablePath, err := resolvePDFNodeExecutable()
	if err != nil {
		return nil, err
	}

	scriptPath, err := resolvePDFMathJaxScriptPath()
	if err != nil {
		return nil, err
	}

	mathJaxDir, err := resolvePDFMathJaxDir()
	if err != nil {
		return nil, err
	}

	return &pdfMathRenderer{
		executablePath: executablePath,
		scriptPath:     scriptPath,
		mathJaxDir:     mathJaxDir,
		cache:          make(map[string]*pdfImageAsset),
	}, nil
}

func (r *pdfRenderer) ensureMathRenderer() (*pdfMathRenderer, error) {
	if r == nil {
		return nil, fmt.Errorf("pdf renderer is not initialized")
	}

	if r.math != nil {
		return r.math, nil
	}

	mathRenderer, err := newPDFMathRenderer()
	if err != nil {
		return nil, err
	}

	r.math = mathRenderer
	return r.math, nil
}

func (r *pdfMathRenderer) render(expression string, display bool, format string) (*pdfImageAsset, error) {
	if r == nil {
		return nil, fmt.Errorf("pdf math renderer is not initialized")
	}

	trimmedExpression := strings.TrimSpace(expression)
	if trimmedExpression == "" {
		return nil, fmt.Errorf("math expression is empty")
	}
	normalizedFormat := normalizePDFMathInputFormat(format)

	cacheKey := fmt.Sprintf("%s:%t:%s", normalizedFormat, display, trimmedExpression)
	r.mu.Lock()
	if asset, exists := r.cache[cacheKey]; exists {
		r.mu.Unlock()
		return asset, nil
	}
	r.mu.Unlock()

	normalizedExpression := trimmedExpression
	if normalizedFormat == "tex" {
		normalizedExpression = normalizePDFMathExpressionForRenderer(trimmedExpression)
		if normalizedExpression == "" {
			normalizedExpression = trimmedExpression
		}
	}

	payload, err := json.Marshal(struct {
		Expression string `json:"expression"`
		Display    bool   `json:"display"`
		Format     string `json:"format"`
	}{
		Expression: normalizedExpression,
		Display:    display,
		Format:     normalizedFormat,
	})
	if err != nil {
		return nil, err
	}

	timeoutContext, cancelTimeout := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelTimeout()

	command := exec.CommandContext(timeoutContext, r.executablePath, r.scriptPath)
	command.Env = append(os.Environ(), "BLOG_PDF_MATHJAX_DIR="+r.mathJaxDir)
	command.Stdin = bytes.NewReader(payload)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("MathJax render failed: %s", message)
	}

	var response pdfMathRenderResponse
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		return nil, fmt.Errorf("failed to decode MathJax render output: %w", err)
	}

	if response.Error != "" {
		return nil, fmt.Errorf("MathJax render error: %s", response.Error)
	}

	encodedPNG := strings.TrimSpace(response.PNG)
	if encodedPNG == "" {
		return nil, fmt.Errorf("MathJax render output is missing PNG data")
	}

	pngBytes, err := base64.StdEncoding.DecodeString(encodedPNG)
	if err != nil {
		return nil, fmt.Errorf("failed to decode MathJax PNG output: %w", err)
	}

	asset := &pdfImageAsset{
		name:      pdfImageAssetName("math:" + cacheKey),
		data:      pngBytes,
		imageType: "PNG",
	}

	r.mu.Lock()
	r.cache[cacheKey] = asset
	r.mu.Unlock()
	return asset, nil
}

func extractPDFMathPlaceholder(node *htmlnode.Node) (string, bool, string, bool) {
	if node == nil || node.Type != htmlnode.ElementNode {
		return "", false, "", false
	}

	expression := strings.TrimSpace(htmlAttribute(node, pdfMathExpressionAttrName))
	if expression == "" {
		return "", false, "", false
	}

	display := strings.EqualFold(strings.TrimSpace(htmlAttribute(node, pdfMathDisplayAttrName)), "true")
	format := normalizePDFMathInputFormat(htmlAttribute(node, pdfMathFormatAttrName))
	return expression, display, format, true
}

func extractPDFMathOnlyPlaceholders(node *htmlnode.Node) ([]pdfMathPlaceholder, bool) {
	if expression, display, format, ok := extractPDFMathPlaceholder(node); ok {
		return []pdfMathPlaceholder{{expression: expression, display: display, format: format}}, true
	}

	if node == nil {
		return nil, false
	}

	placeholders := make([]pdfMathPlaceholder, 0, 2)
	meaningfulChild := false
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		switch child.Type {
		case htmlnode.TextNode:
			if strings.TrimSpace(child.Data) != "" {
				return nil, false
			}
		case htmlnode.ElementNode:
			if child.DataAtom == atom.Br {
				continue
			}

			nestedPlaceholders, ok := extractPDFMathOnlyPlaceholders(child)
			if !ok {
				return nil, false
			}
			placeholders = append(placeholders, nestedPlaceholders...)
			if len(nestedPlaceholders) > 0 {
				meaningfulChild = true
			}
		default:
			continue
		}
	}

	if !meaningfulChild || len(placeholders) == 0 {
		return nil, false
	}

	return placeholders, true
}

func (r *pdfRenderer) renderMathOnlyBlock(node *htmlnode.Node, indentLevel int) bool {
	if r == nil || node == nil || node.Type != htmlnode.ElementNode {
		return false
	}

	placeholders, ok := extractPDFMathOnlyPlaceholders(node)
	if !ok || len(placeholders) == 0 {
		return false
	}

	mathRenderer, err := r.ensureMathRenderer()
	if err != nil {
		return false
	}

	assets := make([]*pdfImageAsset, 0, len(placeholders))
	for _, placeholder := range placeholders {
		asset, err := mathRenderer.render(placeholder.expression, placeholder.display, placeholder.format)
		if err != nil || asset == nil {
			return false
		}
		assets = append(assets, asset)
	}

	r.pdf.Ln(0.6)
	for _, asset := range assets {
		if !r.drawPDFMathAsset(asset, indentLevel, true) {
			return false
		}
	}
	return true
}

func (r *pdfRenderer) drawPDFMathAsset(asset *pdfImageAsset, indentLevel int, center bool) bool {
	if r == nil || asset == nil {
		return false
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
	if r.remainingPageHeight() < renderHeight+1.6 {
		r.pdf.AddPage()
	}

	x := r.contentX(indentLevel)
	if center && renderWidth < maxWidth {
		x += (maxWidth - renderWidth) / 2
	}

	y := r.pdf.GetY()
	r.pdf.ImageOptions(asset.name, x, y, renderWidth, 0, false, gofpdf.ImageOptions{ImageType: asset.imageType, ReadDpi: true}, 0, "")
	r.pdf.SetY(y + renderHeight + 1.6)
	return true
}
