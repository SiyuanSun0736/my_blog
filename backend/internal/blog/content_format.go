package blog

import (
	"bytes"
	stdhtml "html"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
	htmlnode "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var (
	htmlFileExtensionPattern = regexp.MustCompile(`(?i)\.(html?|xhtml)$`)
	markdownLinkPattern      = regexp.MustCompile(`\[(.*?)\]\((.*?)\)`)
	spacePattern             = regexp.MustCompile(`\s+`)
	htmlBodySanitizer        = newHTMLBodySanitizer()
	mathMLAllowedElements    = []string{
		"math", "semantics", "annotation", "annotation-xml",
		"mrow", "mi", "mn", "mo", "mtext", "ms", "mspace",
		"msub", "msup", "msubsup", "munder", "mover", "munderover",
		"mmultiscripts", "mprescripts", "none", "mfrac", "msqrt", "mroot",
		"mfenced", "menclose", "mtable", "mtr", "mtd", "mstyle",
		"mpadded", "mphantom",
	}
)

func newHTMLBodySanitizer() *bluemonday.Policy {
	policy := bluemonday.UGCPolicy()
	policy.AllowAttrs("class").OnElements("code", "pre", "span", "div")
	policy.AllowAttrs(htmlMathExpressionAttrName, htmlMathDisplayAttrName, htmlMathFormatAttrName).OnElements("span", "div")
	policy.AllowElements(mathMLAllowedElements...)
	policy.AllowAttrs(
		"xmlns",
		"display",
		"displaystyle",
		"mathvariant",
		"mathsize",
		"mathcolor",
		"mathbackground",
		"scriptlevel",
		"stretchy",
		"symmetric",
		"fence",
		"separator",
		"form",
		"linethickness",
		"columnalign",
		"rowalign",
		"columnspan",
		"rowspan",
		"width",
		"height",
		"depth",
		"open",
		"close",
		"encoding",
	).OnElements(mathMLAllowedElements...)
	return policy
}

func normalizeBodyFormat(value BodyFormat) BodyFormat {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(BodyFormatHTML):
		return BodyFormatHTML
	default:
		return BodyFormatMarkdown
	}
}

func normalizeStoredPost(post Post) Post {
	post.BodyFormat = normalizeBodyFormat(post.BodyFormat)
	return post
}

func sanitizeBodyContent(body string, bodyFormat BodyFormat) string {
	trimmedBody := strings.TrimSpace(body)
	if trimmedBody == "" {
		return ""
	}

	if normalizeBodyFormat(bodyFormat) == BodyFormatHTML {
		normalizedBody := normalizeHTMLMathForStorage(trimmedBody)
		return strings.TrimSpace(htmlBodySanitizer.Sanitize(normalizedBody))
	}

	return trimmedBody
}

func normalizeHTMLMathForStorage(body string) string {
	document, err := htmlnode.Parse(strings.NewReader(body))
	if err != nil {
		return body
	}

	root := findFirstNodeByAtom(document, atom.Body)
	if root == nil {
		root = document
	}

	rewriteHTMLMathNodes(root)
	return renderNodeInnerHTML(root)
}

func rewriteHTMLMathNodes(node *htmlnode.Node) {
	if node == nil {
		return
	}

	for child := node.FirstChild; child != nil; {
		nextChild := child.NextSibling
		if replacementNode := newHTMLMathDataNode(child); replacementNode != nil {
			insertHTMLNodeBefore(child, replacementNode)
			detachHTMLNode(child)
			child = nextChild
			continue
		}

		rewriteHTMLMathNodes(child)
		child = nextChild
	}
}

func newHTMLMathDataNode(node *htmlnode.Node) *htmlnode.Node {
	if !isMathMLNode(node) {
		return nil
	}

	expression := strings.TrimSpace(renderSingleNodeHTML(node))
	if expression == "" {
		return nil
	}

	fallbackText := normalizeWhitespace(extractNodeText(node))
	if fallbackText == "" {
		fallbackText = "数学公式"
	}

	mathNode := &htmlnode.Node{
		Type:     htmlnode.ElementNode,
		DataAtom: atom.Span,
		Data:     atom.Span.String(),
		Attr: []htmlnode.Attribute{
			{Key: "class", Val: "html-math-fragment"},
			{Key: htmlMathExpressionAttrName, Val: expression},
			{Key: htmlMathDisplayAttrName, Val: strconv.FormatBool(isBlockMathMLNode(node))},
			{Key: htmlMathFormatAttrName, Val: "mathml"},
		},
	}
	mathNode.AppendChild(&htmlnode.Node{Type: htmlnode.TextNode, Data: fallbackText})
	return mathNode
}

func summarizeBody(body string, bodyFormat BodyFormat) string {
	plain := bodyPlainText(body, bodyFormat)
	if plain == "" {
		return ""
	}

	runes := []rune(plain)
	if len(runes) <= 80 {
		return plain
	}

	return strings.TrimSpace(string(runes[:80])) + "..."
}

func estimateReadMinutesForBody(body string, bodyFormat BodyFormat) int {
	plain := bodyPlainText(body, bodyFormat)
	runeCount := len([]rune(plain))
	if runeCount <= 320 {
		return 1
	}

	minutes := runeCount / 320
	if runeCount%320 != 0 {
		minutes++
	}

	if minutes < 1 {
		return 1
	}

	return minutes
}

func bodyPlainText(body string, bodyFormat BodyFormat) string {
	if normalizeBodyFormat(bodyFormat) == BodyFormatHTML {
		return htmlPlainText(body)
	}

	return markdownPlainText(body)
}

func htmlPlainText(body string) string {
	trimmedBody := strings.TrimSpace(body)
	if trimmedBody == "" {
		return ""
	}

	root, err := htmlnode.Parse(strings.NewReader(trimmedBody))
	if err != nil {
		return normalizeWhitespace(stdhtml.UnescapeString(htmlBodySanitizer.Sanitize(trimmedBody)))
	}

	var builder strings.Builder
	appendHTMLText(&builder, root)
	return normalizeWhitespace(stdhtml.UnescapeString(builder.String()))
}

func appendHTMLText(builder *strings.Builder, node *htmlnode.Node) {
	if node == nil {
		return
	}

	if node.Type == htmlnode.ElementNode {
		switch node.DataAtom {
		case atom.Script, atom.Style, atom.Noscript, atom.Template:
			return
		case atom.Br:
			builder.WriteByte(' ')
			return
		}

		if isHTMLSeparatorNode(node.DataAtom) {
			builder.WriteByte(' ')
		}
	}

	if node.Type == htmlnode.TextNode {
		builder.WriteString(node.Data)
		builder.WriteByte(' ')
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendHTMLText(builder, child)
	}

	if node.Type == htmlnode.ElementNode && isHTMLSeparatorNode(node.DataAtom) {
		builder.WriteByte(' ')
	}
}

func isHTMLSeparatorNode(tag atom.Atom) bool {
	switch tag {
	case atom.Article, atom.Aside, atom.Blockquote, atom.Div, atom.Figcaption, atom.Figure,
		atom.Footer, atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6, atom.Header,
		atom.Li, atom.Main, atom.Nav, atom.Ol, atom.P, atom.Pre, atom.Section, atom.Table,
		atom.Tbody, atom.Td, atom.Th, atom.Thead, atom.Tr, atom.Ul:
		return true
	default:
		return false
	}
}

func parseHTMLImportDocument(fileName string, rawHTML string) (HTMLImportResult, error) {
	document, err := htmlnode.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return HTMLImportResult{}, err
	}

	root := findHTMLImportRoot(document)
	title := firstTextForTag(root, atom.H1)
	if title == "" {
		title = documentTitle(document)
	}
	if title == "" {
		title = stripHTMLDocumentExtension(fileName)
	}

	if heading := findFirstNodeByAtom(root, atom.H1); heading != nil && normalizeWhitespace(extractNodeText(heading)) == normalizeWhitespace(title) {
		detachHTMLNode(heading)
	}

	body := sanitizeBodyContent(renderNodeInnerHTML(root), BodyFormatHTML)
	if body == "" {
		return HTMLImportResult{}, ErrInvalidPost
	}

	summary := extractMetaContent(document, "name", "description")
	if summary == "" {
		summary = summarizeBody(body, BodyFormatHTML)
	}

	return HTMLImportResult{
		Title:   title,
		Slug:    normalizeSlug(stripHTMLDocumentExtension(fileName), title),
		Summary: summary,
		Tags:    splitKeywords(extractMetaContent(document, "name", "keywords")),
		Author:  extractMetaContent(document, "name", "author"),
		PublishedAt: normalizeImportedPublishedAt(
			firstNonEmpty(
				extractMetaContent(document, "property", "article:published_time"),
				extractMetaContent(document, "name", "article:published_time"),
				extractMetaContent(document, "name", "pubdate"),
				extractMetaContent(document, "name", "date"),
			),
		),
		BodyFormat: BodyFormatHTML,
		Body:       body,
	}, nil
}

func findHTMLImportRoot(root *htmlnode.Node) *htmlnode.Node {
	for _, tag := range []atom.Atom{atom.Article, atom.Main, atom.Body} {
		if node := findFirstNodeByAtom(root, tag); node != nil {
			return node
		}
	}

	return root
}

func findFirstNodeByAtom(root *htmlnode.Node, tag atom.Atom) *htmlnode.Node {
	if root == nil {
		return nil
	}

	if root.Type == htmlnode.ElementNode && root.DataAtom == tag {
		return root
	}

	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if match := findFirstNodeByAtom(child, tag); match != nil {
			return match
		}
	}

	return nil
}

func firstTextForTag(root *htmlnode.Node, tag atom.Atom) string {
	node := findFirstNodeByAtom(root, tag)
	if node == nil {
		return ""
	}

	return extractNodeText(node)
}

func extractMetaContent(root *htmlnode.Node, key, value string) string {
	if root == nil {
		return ""
	}

	if root.Type == htmlnode.ElementNode && root.DataAtom == atom.Meta {
		var matched bool
		var content string
		for _, attribute := range root.Attr {
			if strings.EqualFold(attribute.Key, key) && strings.EqualFold(attribute.Val, value) {
				matched = true
			}

			if strings.EqualFold(attribute.Key, "content") {
				content = attribute.Val
			}
		}

		if matched {
			return normalizeWhitespace(stdhtml.UnescapeString(content))
		}
	}

	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if content := extractMetaContent(child, key, value); content != "" {
			return content
		}
	}

	return ""
}

func documentTitle(root *htmlnode.Node) string {
	return firstTextForTag(root, atom.Title)
}

func extractNodeText(node *htmlnode.Node) string {
	if node == nil {
		return ""
	}

	var builder strings.Builder
	appendHTMLText(&builder, node)
	return normalizeWhitespace(stdhtml.UnescapeString(builder.String()))
}

func renderNodeInnerHTML(node *htmlnode.Node) string {
	if node == nil {
		return ""
	}

	var buffer bytes.Buffer
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		_ = htmlnode.Render(&buffer, child)
	}

	return buffer.String()
}

func detachHTMLNode(node *htmlnode.Node) {
	if node == nil || node.Parent == nil {
		return
	}

	if node.PrevSibling != nil {
		node.PrevSibling.NextSibling = node.NextSibling
	} else {
		node.Parent.FirstChild = node.NextSibling
	}

	if node.NextSibling != nil {
		node.NextSibling.PrevSibling = node.PrevSibling
	} else {
		node.Parent.LastChild = node.PrevSibling
	}

	node.Parent = nil
	node.PrevSibling = nil
	node.NextSibling = nil
}

func splitKeywords(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	seen := make(map[string]struct{})
	tags := make([]string, 0)
	for _, part := range strings.Split(value, ",") {
		tag := normalizeWhitespace(part)
		if tag == "" {
			continue
		}

		if _, exists := seen[tag]; exists {
			continue
		}

		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}

	return tags
}

func normalizeImportedPublishedAt(value string) string {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return ""
	}

	if len(trimmedValue) >= len("2006-01-02") {
		candidate := trimmedValue[:len("2006-01-02")]
		if _, err := time.Parse("2006-01-02", candidate); err == nil {
			return candidate
		}
	}

	for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		if parsed, err := time.Parse(layout, trimmedValue); err == nil {
			return parsed.UTC().Format("2006-01-02")
		}
	}

	return ""
}

func stripHTMLDocumentExtension(fileName string) string {
	baseName := filepath.Base(fileName)
	return htmlFileExtensionPattern.ReplaceAllString(baseName, "")
}

func isHTMLDocumentFileName(fileName string) bool {
	return htmlFileExtensionPattern.MatchString(filepath.Base(fileName))
}

func normalizeWhitespace(value string) string {
	return strings.TrimSpace(spacePattern.ReplaceAllString(value, " "))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
