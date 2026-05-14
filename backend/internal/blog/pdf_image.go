package blog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"github.com/phpdave11/gofpdf"
	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	_ "golang.org/x/image/webp"
)

const (
	maxPDFImageBytes         = 6 * 1024 * 1024
	pdfExternalImageTimeout  = 8 * time.Second
	pdfExternalRedirectLimit = 3
	pdfMaxRasterDimension    = 1024
)

type pdfImageAsset struct {
	name      string
	data      []byte
	imageType string
}

type pdfImageSource struct {
	cacheKey    string
	contentType string
	data        []byte
}

func (r *pdfRenderer) resolveImageAsset(rawSource string) (*pdfImageAsset, error) {
	source, err := r.readImageSource(rawSource)
	if err != nil {
		return nil, err
	}

	return preparePDFImageAsset(source)
}

func (r *pdfRenderer) readImageSource(rawSource string) (pdfImageSource, error) {
	trimmedSource := strings.TrimSpace(rawSource)
	if trimmedSource == "" {
		return pdfImageSource{}, fmt.Errorf("image source is empty")
	}

	if source, ok, err := r.readLocalImageSource(trimmedSource); ok || err != nil {
		return source, err
	}

	if source, ok, err := readExternalImageSource(trimmedSource); ok || err != nil {
		return source, err
	}

	return pdfImageSource{}, fmt.Errorf("unsupported image source: %s", trimmedSource)
}

func (r *pdfRenderer) readLocalImageSource(rawSource string) (pdfImageSource, bool, error) {
	if r.mediaDir == "" {
		return pdfImageSource{}, false, nil
	}

	normalizedPath := normalizeReferencedMediaPath(rawSource, r.mediaURLPath)
	if normalizedPath == "" {
		return pdfImageSource{}, false, nil
	}

	relativePath := strings.TrimPrefix(normalizedPath, r.mediaURLPath)
	relativePath = strings.TrimLeft(relativePath, "/")
	localPath := filepath.Join(r.mediaDir, filepath.FromSlash(relativePath))
	fileInfo, err := os.Stat(localPath)
	if err != nil {
		return pdfImageSource{}, true, err
	}

	if fileInfo.Size() > maxPDFImageBytes {
		return pdfImageSource{}, true, fmt.Errorf("image exceeds %d bytes", maxPDFImageBytes)
	}

	imageBytes, err := os.ReadFile(localPath)
	if err != nil {
		return pdfImageSource{}, true, err
	}

	return pdfImageSource{
		cacheKey:    normalizedPath,
		contentType: imageContentTypeHint(localPath, imageBytes),
		data:        imageBytes,
	}, true, nil
}

func readExternalImageSource(rawSource string) (pdfImageSource, bool, error) {
	normalizedSource := strings.TrimSpace(rawSource)
	if strings.HasPrefix(normalizedSource, "//") {
		normalizedSource = "https:" + normalizedSource
	}

	parsedURL, err := url.Parse(normalizedSource)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return pdfImageSource{}, false, nil
	}

	if err := validatePublicImageURL(parsedURL); err != nil {
		return pdfImageSource{}, true, err
	}

	client := &http.Client{
		Timeout: pdfExternalImageTimeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= pdfExternalRedirectLimit {
				return fmt.Errorf("too many image redirects")
			}

			return validatePublicImageURL(request.URL)
		},
	}

	request, err := http.NewRequest(http.MethodGet, parsedURL.String(), nil)
	if err != nil {
		return pdfImageSource{}, true, err
	}
	request.Header.Set("User-Agent", "Wanderlust-PDF/1.0")

	response, err := client.Do(request)
	if err != nil {
		return pdfImageSource{}, true, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return pdfImageSource{}, true, fmt.Errorf("unexpected image status: %d", response.StatusCode)
	}

	imageBytes, err := io.ReadAll(io.LimitReader(response.Body, maxPDFImageBytes+1))
	if err != nil {
		return pdfImageSource{}, true, err
	}

	if len(imageBytes) > maxPDFImageBytes {
		return pdfImageSource{}, true, fmt.Errorf("image exceeds %d bytes", maxPDFImageBytes)
	}

	return pdfImageSource{
		cacheKey:    parsedURL.String(),
		contentType: imageContentTypeHint(parsedURL.Path, imageBytes, response.Header.Get("Content-Type")),
		data:        imageBytes,
	}, true, nil
}

func preparePDFImageAsset(source pdfImageSource) (*pdfImageAsset, error) {
	if len(source.data) == 0 {
		return nil, fmt.Errorf("image payload is empty")
	}

	if isSVGImageSource(source.cacheKey, source.contentType, source.data) {
		pngBytes, err := rasterizeSVGToPNG(source.data)
		if err != nil {
			return nil, err
		}

		return &pdfImageAsset{
			name:      pdfImageAssetName(source.cacheKey),
			data:      pngBytes,
			imageType: "PNG",
		}, nil
	}

	decodedImage, _, err := image.Decode(bytes.NewReader(source.data))
	if err != nil {
		return nil, err
	}

	var buffer bytes.Buffer
	if err := png.Encode(&buffer, decodedImage); err != nil {
		return nil, err
	}

	return &pdfImageAsset{
		name:      pdfImageAssetName(source.cacheKey),
		data:      buffer.Bytes(),
		imageType: "PNG",
	}, nil
}

func rasterizeSVGToPNG(svgBytes []byte) ([]byte, error) {
	if pngBytes, err := rasterizeSVGToPNGWithChromium(svgBytes); err == nil {
		return pngBytes, nil
	}

	return rasterizeSVGToPNGWithOKSVG(svgBytes)
}

func rasterizeSVGToPNGWithOKSVG(svgBytes []byte) ([]byte, error) {
	icon, err := oksvg.ReadIconStream(bytes.NewReader(svgBytes))
	if err != nil {
		return nil, err
	}

	renderWidth, renderHeight := svgRenderSize(icon)
	icon.SetTarget(0, 0, float64(renderWidth), float64(renderHeight))

	rgbaImage := image.NewRGBA(image.Rect(0, 0, renderWidth, renderHeight))
	scanner := rasterx.NewScannerGV(renderWidth, renderHeight, rgbaImage, rgbaImage.Bounds())
	dasher := rasterx.NewDasher(renderWidth, renderHeight, scanner)
	icon.Draw(dasher, 1)

	var buffer bytes.Buffer
	if err := png.Encode(&buffer, rgbaImage); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

func rasterizeSVGToPNGWithChromium(svgBytes []byte) ([]byte, error) {
	executablePath, err := resolvePDFChromiumExecutable()
	if err != nil {
		return nil, err
	}

	icon, err := oksvg.ReadIconStream(bytes.NewReader(svgBytes))
	if err != nil {
		return nil, err
	}

	renderWidth, renderHeight := svgRenderSize(icon)
	encodedSVG := base64.StdEncoding.EncodeToString(svgBytes)
	documentHTML := fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: %dpx;
      height: %dpx;
      overflow: hidden;
      background: transparent;
    }

    body {
      display: flex;
      align-items: stretch;
      justify-content: stretch;
    }

    img {
      display: block;
      width: %dpx;
      height: %dpx;
    }
  </style>
</head>
<body data-ready="loading">
  <img id="svg-image" src="data:image/svg+xml;base64,%s" alt="svg" onload="document.body.dataset.ready='true'" onerror="document.body.dataset.ready='error'" />
</body>
</html>`, renderWidth, renderHeight, renderWidth, renderHeight, encodedSVG)

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

	timeoutContext, cancelTimeout := context.WithTimeout(browserContext, 20*time.Second)
	defer cancelTimeout()

	var pngBytes []byte
	err = chromedp.Run(timeoutContext,
		chromedp.EmulateViewport(int64(renderWidth), int64(renderHeight)),
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
		chromedp.FullScreenshot(&pngBytes, 100),
	)
	if err != nil {
		return nil, err
	}

	if len(pngBytes) == 0 {
		return nil, fmt.Errorf("chromium returned an empty svg screenshot")
	}

	return pngBytes, nil
}

func svgRenderSize(icon *oksvg.SvgIcon) (int, int) {
	width := icon.ViewBox.W
	height := icon.ViewBox.H
	if width <= 0 || height <= 0 {
		width = 1200
		height = 800
	}

	if width > pdfMaxRasterDimension {
		scale := pdfMaxRasterDimension / width
		width *= scale
		height *= scale
	}

	if height > pdfMaxRasterDimension {
		scale := pdfMaxRasterDimension / height
		width *= scale
		height *= scale
	}

	return maxInt(1, int(math.Ceil(width))), maxInt(1, int(math.Ceil(height)))
}

func validatePublicImageURL(parsedURL *url.URL) error {
	if parsedURL == nil {
		return fmt.Errorf("image url is required")
	}

	hostName := strings.TrimSpace(parsedURL.Hostname())
	if hostName == "" {
		return fmt.Errorf("image host is required")
	}

	if ip := net.ParseIP(hostName); ip != nil {
		if !isPublicIP(ip) {
			return fmt.Errorf("private image hosts are not allowed")
		}

		return nil
	}

	resolvedIPs, err := net.LookupIP(hostName)
	if err != nil {
		return err
	}
	if len(resolvedIPs) == 0 {
		return fmt.Errorf("image host did not resolve")
	}

	for _, resolvedIP := range resolvedIPs {
		if !isPublicIP(resolvedIP) {
			return fmt.Errorf("private image hosts are not allowed")
		}
	}

	return nil
}

func isPublicIP(ip net.IP) bool {
	return ip != nil && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast() && !ip.IsUnspecified()
}

func isSVGImageSource(cacheKey string, contentType string, imageBytes []byte) bool {
	if strings.Contains(strings.ToLower(contentType), "svg") {
		return true
	}

	if strings.EqualFold(filepath.Ext(cacheKey), ".svg") {
		return true
	}

	header := strings.ToLower(string(bytes.TrimSpace(imageBytes[:minInt(len(imageBytes), 512)])))
	return strings.Contains(header, "<svg")
}

func imageContentTypeHint(pathOrURL string, imageBytes []byte, explicitContentType ...string) string {
	for _, contentType := range explicitContentType {
		trimmed := strings.TrimSpace(contentType)
		if trimmed != "" {
			return trimmed
		}
	}

	extension := strings.ToLower(filepath.Ext(pathOrURL))
	switch extension {
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	}

	if len(imageBytes) == 0 {
		return ""
	}

	detected := http.DetectContentType(imageBytes[:minInt(len(imageBytes), 512)])
	if detected == "text/plain; charset=utf-8" && isSVGImageSource(pathOrURL, "", imageBytes) {
		return "image/svg+xml"
	}

	return detected
}

func pdfImageAssetName(cacheKey string) string {
	sum := sha256.Sum256([]byte(cacheKey))
	return fmt.Sprintf("img-%x", sum[:8])
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}

	return right
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}

	return right
}

func registerPDFImage(pdf *gofpdf.Fpdf, asset *pdfImageAsset) *gofpdf.ImageInfoType {
	if pdf == nil || asset == nil {
		return nil
	}

	return pdf.RegisterImageOptionsReader(asset.name, gofpdf.ImageOptions{ImageType: asset.imageType, ReadDpi: true}, bytes.NewReader(asset.data))
}
