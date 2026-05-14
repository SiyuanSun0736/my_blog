package blog

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/phpdave11/gofpdf"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type PDFRenderOptions struct {
	MediaDir     string
	MediaURLPath string
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
}

var (
	pdfAccentHexPattern = regexp.MustCompile(`#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})`)
	markdownToHTML      = goldmark.New(goldmark.WithExtensions(extension.GFM))
	pdfFontCandidates   = []string{
		"/usr/share/fonts/droid-nonlatin/DroidSansFallbackFull.ttf",
		"/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
		"/usr/share/fonts/droid-nonlatin/DroidSansFallback.ttf",
		"/usr/share/fonts/truetype/droid/DroidSansFallback.ttf",
	}
)

func buildPostPDF(input PDFExportInput, options PDFRenderOptions) ([]byte, string, error) {
	normalized, err := normalizePDFExportInput(input)
	if err != nil {
		return nil, "", err
	}

	fontPath, err := resolvePDFFontPath()
	if err != nil {
		return nil, "", err
	}

	pdf := gofpdf.New("P", "mm", "A4", filepath.Dir(fontPath))
	pdf.SetMargins(18, 18, 18)
	pdf.SetAutoPageBreak(true, 18)
	pdf.SetTitle(normalized.Title, true)
	pdf.SetAuthor(normalized.Author, true)
	pdf.SetSubject(normalized.Category, true)
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

	renderer.renderHeader(normalized)
	bodyHTML, err := renderPostBodyHTML(normalized.Body, normalized.BodyFormat)
	if err != nil {
		return nil, "", err
	}

	if err := renderer.renderBody(bodyHTML); err != nil {
		return nil, "", err
	}

	var buffer bytes.Buffer
	if err := pdf.Output(&buffer); err != nil {
		return nil, "", err
	}

	return buffer.Bytes(), buildPDFFileName(normalized.Title), nil
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

func renderPostBodyHTML(body string, bodyFormat BodyFormat) (string, error) {
	if normalizeBodyFormat(bodyFormat) == BodyFormatHTML {
		return sanitizeBodyContent(body, BodyFormatHTML), nil
	}

	var buffer bytes.Buffer
	if err := markdownToHTML.Convert([]byte(body), &buffer); err != nil {
		return "", err
	}

	return buffer.String(), nil
}

func (r *pdfRenderer) renderHeader(document normalizedPDFExport) {
	red, green, blue := parseAccentColor(document.Accent)
	r.pdf.SetFillColor(red, green, blue)
	r.pdf.Rect(r.leftMargin, r.pdf.GetY(), r.contentWidth(0), 4, "F")
	r.pdf.Ln(9)

	r.pdf.SetTextColor(36, 24, 15)
	r.pdf.SetFont(r.fontFamily, "", 26)
	r.writeTextBlock(document.Title, 11.5, 0)

	if document.Summary != "" {
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(document.Summary, 7, 0)
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
		r.pdf.SetFont(r.fontFamily, "", 12)
		r.writeTextBlock(collectInlineText(node), 6.8, indentLevel)
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

		prefix := "•"
		if ordered {
			prefix = fmt.Sprintf("%d.", itemIndex)
			itemIndex++
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
	codeText := strings.TrimSpace(extractNodeRawText(node))
	if codeText == "" {
		return
	}

	x := r.contentX(indentLevel)
	width := r.contentWidth(indentLevel)
	y := r.pdf.GetY()
	r.pdf.SetFillColor(251, 247, 240)
	r.pdf.SetDrawColor(221, 212, 199)
	r.pdf.SetFont(r.fontFamily, "", 10.5)
	heightEstimate := codeBlockHeightEstimate(codeText, width)
	r.pdf.Rect(x, y, width, heightEstimate, "FD")
	r.pdf.SetXY(x+2.5, y+2.2)
	r.pdf.MultiCell(width-5, 5.2, codeText, "", "L", false)
	r.pdf.SetY(maxFloat(r.pdf.GetY()+2, y+heightEstimate+2))
}

func (r *pdfRenderer) renderImage(node *htmlnode.Node, indentLevel int) {
	imageSource := htmlAttribute(node, "src")
	imageAlt := htmlAttribute(node, "alt")
	if imageSource == "" {
		return
	}

	resolvedPath, imageType := r.localImagePath(imageSource)
	if resolvedPath == "" || imageType == "" {
		fallbackText := imageSource
		if imageAlt != "" {
			fallbackText = imageAlt + " · " + imageSource
		}
		r.pdf.SetFont(r.fontFamily, "", 10.5)
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(fallbackText, 5.8, indentLevel)
		r.pdf.SetTextColor(36, 24, 15)
		return
	}

	options := gofpdf.ImageOptions{ImageType: imageType, ReadDpi: true}
	info := r.pdf.RegisterImageOptions(resolvedPath, options)
	if info == nil {
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
	r.pdf.ImageOptions(resolvedPath, x, y, renderWidth, 0, false, options, 0, "")
	r.pdf.SetY(y + renderHeight + 2)

	if imageAlt != "" {
		r.pdf.SetFont(r.fontFamily, "", 10)
		r.pdf.SetTextColor(98, 82, 68)
		r.writeTextBlock(imageAlt, 5.6, indentLevel)
		r.pdf.SetTextColor(36, 24, 15)
	}
}

func (r *pdfRenderer) renderTable(node *htmlnode.Node, indentLevel int) {
	rows := extractTableRows(node)
	if len(rows) == 0 {
		return
	}

	r.pdf.SetFont(r.fontFamily, "", 10.5)
	for _, row := range rows {
		r.writeTextBlock(strings.Join(row, " | "), 5.8, indentLevel)
	}
}

func (r *pdfRenderer) writeTextBlock(text string, lineHeight float64, indentLevel int) {
	normalizedText := strings.TrimSpace(text)
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

func (r *pdfRenderer) localImagePath(rawSource string) (string, string) {
	if r.mediaDir == "" {
		return "", ""
	}

	normalizedPath := normalizeReferencedMediaPath(rawSource, r.mediaURLPath)
	if normalizedPath == "" {
		return "", ""
	}

	relativePath := strings.TrimPrefix(normalizedPath, r.mediaURLPath)
	relativePath = strings.TrimLeft(relativePath, "/")
	localPath := filepath.Join(r.mediaDir, filepath.FromSlash(relativePath))
	if _, err := os.Stat(localPath); err != nil {
		return "", ""
	}

	switch strings.ToLower(filepath.Ext(localPath)) {
	case ".jpg", ".jpeg":
		return localPath, "JPG"
	case ".png":
		return localPath, "PNG"
	case ".gif":
		return localPath, "GIF"
	default:
		return "", ""
	}
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

func extractTableRows(node *htmlnode.Node) [][]string {
	rows := make([][]string, 0)
	var walk func(*htmlnode.Node)
	walk = func(current *htmlnode.Node) {
		if current == nil {
			return
		}

		if current.Type == htmlnode.ElementNode && current.DataAtom == atom.Tr {
			cells := make([]string, 0)
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
				cells = append(cells, text)
			}

			if len(cells) > 0 {
				rows = append(rows, cells)
			}
		}

		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}

	walk(node)
	return rows
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
