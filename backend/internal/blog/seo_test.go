package blog

import (
	"encoding/xml"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildSitemapXMLIncludesPublicRoutes(t *testing.T) {
	t.Parallel()

	payload, err := buildSitemapXML("https://wanderlust0736.top", []Post{
		{Slug: "go-runtime-notes", PublishedAt: "2026-05-13"},
		{Slug: "compiler-passes", PublishedAt: "2026-05-11"},
	})
	if err != nil {
		t.Fatalf("buildSitemapXML returned error: %v", err)
	}

	var urlset sitemapURLSet
	if err := xml.Unmarshal(payload, &urlset); err != nil {
		t.Fatalf("unmarshal sitemap xml: %v", err)
	}

	if urlset.XMLNS != sitemapXMLNamespace {
		t.Fatalf("expected sitemap namespace %q, got %q", sitemapXMLNamespace, urlset.XMLNS)
	}

	entriesByLoc := make(map[string]sitemapURL, len(urlset.URLs))
	for _, entry := range urlset.URLs {
		entriesByLoc[entry.Loc] = entry
	}

	assertSitemapEntry(t, entriesByLoc, "https://wanderlust0736.top/", "2026-05-13")
	assertSitemapEntry(t, entriesByLoc, "https://wanderlust0736.top/archive", "2026-05-13")
	assertSitemapEntry(t, entriesByLoc, "https://wanderlust0736.top/posts/go-runtime-notes", "2026-05-13")
	assertSitemapEntry(t, entriesByLoc, "https://wanderlust0736.top/posts/compiler-passes", "2026-05-11")

	if _, exists := entriesByLoc["https://wanderlust0736.top/admin"]; exists {
		t.Fatal("did not expect admin route in sitemap")
	}
	if _, exists := entriesByLoc["https://wanderlust0736.top/write"]; exists {
		t.Fatal("did not expect write route in sitemap")
	}
	if len(entriesByLoc) != 4 {
		t.Fatalf("expected 4 sitemap entries, got %d", len(entriesByLoc))
	}
}

func TestBuildRobotsTXTIncludesSitemapAndCrawlerRules(t *testing.T) {
	t.Parallel()

	robotsTXT := buildRobotsTXT("https://wanderlust0736.top")

	for _, snippet := range []string{
		"User-agent: *",
		"Allow: /",
		"Disallow: /admin",
		"Disallow: /write",
		"Disallow: /api/",
		"Sitemap: https://wanderlust0736.top/sitemap.xml",
	} {
		if !containsLine(robotsTXT, snippet) {
			t.Fatalf("expected robots.txt to contain %q, got %q", snippet, robotsTXT)
		}
	}
}

func TestRequestBaseURLPrefersForwardedHeaders(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "http://127.0.0.1/robots.txt", nil)
	request.Host = "127.0.0.1"
	request.Header.Set("X-Forwarded-Proto", "https, http")
	request.Header.Set("X-Forwarded-Host", "wanderlust0736.top, proxy.internal")

	if got := requestBaseURL(request); got != "https://wanderlust0736.top" {
		t.Fatalf("expected forwarded base url, got %q", got)
	}
}

func assertSitemapEntry(t *testing.T, entriesByLoc map[string]sitemapURL, loc string, lastMod string) {
	t.Helper()

	entry, exists := entriesByLoc[loc]
	if !exists {
		t.Fatalf("expected sitemap to contain %q", loc)
	}

	if entry.LastMod != lastMod {
		t.Fatalf("expected %q lastmod %q, got %q", loc, lastMod, entry.LastMod)
	}
}

func containsLine(content string, want string) bool {
	return strings.Contains(content, want)
}
