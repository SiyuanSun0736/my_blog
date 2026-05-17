package blog

import (
	stdhtml "html"
	"regexp"
	"sort"
	"strings"
)

const (
	searchSnippetContextRunes = 56
	searchSnippetMaxRunes     = 140
)

type searchSnippetSource struct {
	field string
	label string
	text  string
}

func searchTokens(query string) []string {
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(query)))
	if len(parts) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(parts))
	tokens := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := strings.Trim(part, "\"'“”‘’`()[]{}<>")
		if normalized == "" {
			continue
		}

		if _, exists := seen[normalized]; exists {
			continue
		}

		seen[normalized] = struct{}{}
		tokens = append(tokens, normalized)
	}

	return tokens
}

func buildSearchSnippet(post Post, query string) *SearchSnippet {
	tokens := searchTokens(query)
	if len(tokens) == 0 {
		return nil
	}

	sources := []searchSnippetSource{
		{field: "title", label: "标题", text: post.Title},
		{field: "author", label: "作者", text: post.Author},
		{field: "slug", label: "Slug", text: post.Slug},
		{field: "tags", label: "标签", text: strings.Join(post.Tags, " · ")},
		{field: "summary", label: "摘要", text: post.Summary},
		{field: "category", label: "分类", text: post.Category},
		{field: "body", label: "正文", text: bodyPlainText(post.Body, post.BodyFormat)},
	}

	for _, source := range sources {
		plain := normalizeWhitespace(source.text)
		if plain == "" {
			continue
		}

		snippet, matched := extractSnippetWindow(plain, tokens)
		if !matched {
			continue
		}

		return &SearchSnippet{
			Field: source.field,
			Label: source.label,
			Text:  snippet,
			HTML:  highlightSnippetHTML(snippet, tokens),
		}
	}

	return nil
}

func highlightSnippetHTML(text string, tokens []string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}

	patternTokens := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if token == "" {
			continue
		}

		patternTokens = append(patternTokens, regexp.QuoteMeta(token))
	}

	if len(patternTokens) == 0 {
		return stdhtml.EscapeString(text)
	}

	sort.SliceStable(patternTokens, func(left, right int) bool {
		return len(patternTokens[left]) > len(patternTokens[right])
	})

	re := regexp.MustCompile(`(?i)(` + strings.Join(patternTokens, `|`) + `)`)
	indices := re.FindAllStringIndex(text, -1)
	if len(indices) == 0 {
		return stdhtml.EscapeString(text)
	}

	var builder strings.Builder
	lastIndex := 0
	for _, indexPair := range indices {
		if indexPair[0] < lastIndex {
			continue
		}

		builder.WriteString(stdhtml.EscapeString(text[lastIndex:indexPair[0]]))
		builder.WriteString("<mark>")
		builder.WriteString(stdhtml.EscapeString(text[indexPair[0]:indexPair[1]]))
		builder.WriteString("</mark>")
		lastIndex = indexPair[1]
	}

	builder.WriteString(stdhtml.EscapeString(text[lastIndex:]))
	return builder.String()
}

func extractSnippetWindow(text string, tokens []string) (string, bool) {
	runes := []rune(text)
	start, end, matched := firstTokenMatchWindow(runes, tokens)
	if !matched {
		return "", false
	}

	windowStart := maxInt(0, start-searchSnippetContextRunes)
	windowEnd := minInt(len(runes), end+searchSnippetContextRunes)
	if windowEnd-windowStart > searchSnippetMaxRunes {
		matchWidth := end - start
		remaining := maxInt(0, searchSnippetMaxRunes-matchWidth)
		leftPadding := remaining / 2
		rightPadding := remaining - leftPadding
		windowStart = maxInt(0, start-leftPadding)
		windowEnd = minInt(len(runes), end+rightPadding)
		if windowEnd-windowStart < searchSnippetMaxRunes && windowStart > 0 {
			windowStart = maxInt(0, windowEnd-searchSnippetMaxRunes)
		}
		if windowEnd-windowStart < searchSnippetMaxRunes && windowEnd < len(runes) {
			windowEnd = minInt(len(runes), windowStart+searchSnippetMaxRunes)
		}
	}

	snippet := strings.TrimSpace(string(runes[windowStart:windowEnd]))
	if snippet == "" {
		return "", false
	}

	if windowStart > 0 {
		snippet = "…" + snippet
	}
	if windowEnd < len(runes) {
		snippet += "…"
	}

	return snippet, true
}

func firstTokenMatchWindow(runes []rune, tokens []string) (int, int, bool) {
	lowerRunes := []rune(strings.ToLower(string(runes)))
	bestStart := -1
	bestEnd := -1

	for _, token := range tokens {
		needle := []rune(strings.ToLower(token))
		if len(needle) == 0 {
			continue
		}

		index := indexRunes(lowerRunes, needle)
		if index >= 0 && (bestStart == -1 || index < bestStart) {
			bestStart = index
			bestEnd = index + len(needle)
		}
	}

	if bestStart < 0 {
		return 0, 0, false
	}

	return bestStart, bestEnd, true
}

func indexRunes(haystack []rune, needle []rune) int {
	if len(needle) == 0 {
		return 0
	}

	if len(needle) > len(haystack) {
		return -1
	}

	limit := len(haystack) - len(needle)
	for start := 0; start <= limit; start++ {
		matched := true
		for offset := range needle {
			if haystack[start+offset] != needle[offset] {
				matched = false
				break
			}
		}

		if matched {
			return start
		}
	}

	return -1
}
