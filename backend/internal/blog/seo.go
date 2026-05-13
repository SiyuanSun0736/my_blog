package blog

import (
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

const sitemapXMLNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9"

type sitemapURLSet struct {
	XMLName xml.Name     `xml:"urlset"`
	XMLNS   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

type sitemapURL struct {
	Loc        string `xml:"loc"`
	LastMod    string `xml:"lastmod,omitempty"`
	ChangeFreq string `xml:"changefreq,omitempty"`
	Priority   string `xml:"priority,omitempty"`
}

func (h *Handler) RegisterMetadataRoutes(router gin.IRoutes) {
	router.GET("/sitemap.xml", h.sitemap)
	router.GET("/robots.txt", h.robots)
}

func (h *Handler) sitemap(c *gin.Context) {
	posts, err := h.service.ListPosts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to generate sitemap"})
		return
	}

	baseURL := requestBaseURL(c.Request)
	if baseURL == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to resolve public host"})
		return
	}

	payload, err := buildSitemapXML(baseURL, posts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to encode sitemap"})
		return
	}

	c.Data(http.StatusOK, "application/xml; charset=utf-8", payload)
}

func (h *Handler) robots(c *gin.Context) {
	baseURL := requestBaseURL(c.Request)
	if baseURL == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to resolve public host"})
		return
	}

	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(buildRobotsTXT(baseURL)))
}

func buildSitemapXML(baseURL string, posts []Post) ([]byte, error) {
	latestPublishedAt := latestPublishedAt(posts)
	urls := []sitemapURL{
		{
			Loc:        absolutePublicURL(baseURL, "/"),
			LastMod:    latestPublishedAt,
			ChangeFreq: "daily",
			Priority:   "1.0",
		},
		{
			Loc:        absolutePublicURL(baseURL, "/archive"),
			LastMod:    latestPublishedAt,
			ChangeFreq: "daily",
			Priority:   "0.8",
		},
	}

	for _, post := range posts {
		urls = append(urls, sitemapURL{
			Loc:        absolutePublicURL(baseURL, "/posts/"+url.PathEscape(post.Slug)),
			LastMod:    post.PublishedAt,
			ChangeFreq: "monthly",
			Priority:   "0.7",
		})
	}

	payload, err := xml.MarshalIndent(sitemapURLSet{
		XMLNS: sitemapXMLNamespace,
		URLs:  urls,
	}, "", "  ")
	if err != nil {
		return nil, err
	}

	return append([]byte(xml.Header), payload...), nil
}

func buildRobotsTXT(baseURL string) string {
	return strings.Join([]string{
		"User-agent: *",
		"Allow: /",
		"Disallow: /admin",
		"Disallow: /write",
		"Disallow: /api/",
		"",
		"Sitemap: " + absolutePublicURL(baseURL, "/sitemap.xml"),
		"",
	}, "\n")
}

func latestPublishedAt(posts []Post) string {
	latest := ""
	for _, post := range posts {
		if post.PublishedAt > latest {
			latest = post.PublishedAt
		}
	}

	return latest
}

func absolutePublicURL(baseURL string, routePath string) string {
	trimmedBaseURL := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmedBaseURL == "" {
		return routePath
	}

	if routePath == "" || routePath == "/" {
		return trimmedBaseURL + "/"
	}

	if strings.HasPrefix(routePath, "/") {
		return trimmedBaseURL + routePath
	}

	return trimmedBaseURL + "/" + routePath
}

func requestBaseURL(request *http.Request) string {
	if request == nil {
		return ""
	}

	proto := firstHeaderValue(request.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}

	host := firstHeaderValue(request.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(request.Host)
	}
	if host == "" {
		return ""
	}

	return proto + "://" + host
}

func firstHeaderValue(value string) string {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return ""
	}

	if commaIndex := strings.Index(trimmedValue, ","); commaIndex >= 0 {
		trimmedValue = strings.TrimSpace(trimmedValue[:commaIndex])
	}

	return trimmedValue
}
