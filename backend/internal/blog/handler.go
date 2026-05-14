package blog

import (
	"crypto/subtle"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const writeTokenEnvName = "BLOG_WRITE_TOKEN"

const maxHTMLImportBytes = 4 * 1024 * 1024

type Handler struct {
	service        *Service
	mediaDir       string
	mediaURLPath   string
	maxUploadBytes int64
	uploadCache    UploadCache
}

type HandlerOptions struct {
	MediaDir       string
	MediaURLPath   string
	MaxUploadBytes int64
	UploadCache    UploadCache
}

func NewHandler(service *Service, options HandlerOptions) *Handler {
	mediaDir := strings.TrimSpace(options.MediaDir)
	if mediaDir == "" {
		mediaDir = defaultMediaDir
	}

	maxUploadBytes := options.MaxUploadBytes
	if maxUploadBytes <= 0 {
		maxUploadBytes = defaultMaxUploadBytes
	}

	uploadCache := options.UploadCache
	if uploadCache == nil {
		uploadCache = noopUploadCache{}
	}

	return &Handler{
		service:        service,
		mediaDir:       mediaDir,
		mediaURLPath:   normalizeMediaURLPath(options.MediaURLPath),
		maxUploadBytes: maxUploadBytes,
		uploadCache:    uploadCache,
	}
}

func (h *Handler) RegisterRoutes(router gin.IRoutes) {
	router.GET("/posts", h.listPosts)
	router.GET("/posts/:slug", h.getPost)
	router.GET("/admin/posts", h.requireWriteAccess, h.listAdminPosts)
	router.GET("/admin/posts/:slug", h.requireWriteAccess, h.getAdminPost)
	router.POST("/admin/posts/batch", h.requireWriteAccess, h.batchPosts)
	router.POST("/admin/exports/pdf", h.requireWriteAccess, h.exportPDF)
	router.POST("/admin/imports/html", h.requireWriteAccess, h.importHTMLDocument)
	router.POST("/admin/uploads/images", h.requireWriteAccess, h.uploadImage)
	router.GET("/write-access", h.requireWriteAccess, h.confirmWriteAccess)
	router.POST("/posts", h.requireWriteAccess, h.createPost)
	router.PUT("/posts/:slug", h.requireWriteAccess, h.updatePost)
	router.PATCH("/posts/:slug/featured", h.requireWriteAccess, h.setPostFeatured)
	router.DELETE("/posts/:slug", h.requireWriteAccess, h.deletePost)
}

func (h *Handler) listPosts(c *gin.Context) {
	posts, err := h.service.ListPosts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to list posts"})
		return
	}

	c.JSON(http.StatusOK, posts)
}

func (h *Handler) getPost(c *gin.Context) {
	post, found, err := h.service.GetPostBySlug(c.Request.Context(), c.Param("slug"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load post"})
		return
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
		return
	}

	c.JSON(http.StatusOK, post)
}

func (h *Handler) listAdminPosts(c *gin.Context) {
	posts, err := h.service.ListAdminPosts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to list admin posts"})
		return
	}

	c.JSON(http.StatusOK, posts)
}

func (h *Handler) getAdminPost(c *gin.Context) {
	post, found, err := h.service.GetAdminPostBySlug(c.Request.Context(), c.Param("slug"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load admin post"})
		return
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
		return
	}

	c.JSON(http.StatusOK, post)
}

func (h *Handler) requireWriteAccess(c *gin.Context) {
	configuredToken := strings.TrimSpace(os.Getenv(writeTokenEnvName))
	if configuredToken == "" {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"message": "write access is not configured"})
		return
	}

	authorization := strings.TrimSpace(c.GetHeader("Authorization"))
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(authorization, bearerPrefix) {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "write access denied"})
		return
	}

	providedToken := strings.TrimSpace(strings.TrimPrefix(authorization, bearerPrefix))
	if subtle.ConstantTimeCompare([]byte(providedToken), []byte(configuredToken)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "write access denied"})
		return
	}

	c.Next()
}

func (h *Handler) confirmWriteAccess(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "write access granted"})
}

func (h *Handler) createPost(c *gin.Context) {
	var request CreatePostInput

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid post payload"})
		return
	}

	post, err := h.service.CreatePost(c.Request.Context(), request)
	if err != nil {
		if err == ErrInvalidPost {
			c.JSON(http.StatusBadRequest, gin.H{"message": "title, body or publishedAt is invalid"})
			return
		}

		if err == ErrFeaturedLimit {
			c.JSON(http.StatusBadRequest, gin.H{"message": "featured post limit reached (max 3)"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to create post"})
		return
	}

	c.JSON(http.StatusCreated, post)
}

func (h *Handler) updatePost(c *gin.Context) {
	var request CreatePostInput

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid post payload"})
		return
	}

	post, err := h.service.UpdatePost(c.Request.Context(), c.Param("slug"), request)
	if err != nil {
		switch err {
		case ErrInvalidPost:
			c.JSON(http.StatusBadRequest, gin.H{"message": "title, body or publishedAt is invalid"})
		case ErrFeaturedLimit:
			c.JSON(http.StatusBadRequest, gin.H{"message": "featured post limit reached (max 3)"})
		case ErrPostNotFound:
			c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update post"})
		}
		return
	}

	c.JSON(http.StatusOK, post)
}

func (h *Handler) setPostFeatured(c *gin.Context) {
	var request SetPostFeaturedInput

	if err := c.ShouldBindJSON(&request); err != nil || request.Featured == nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid featured payload"})
		return
	}

	post, err := h.service.SetPostFeatured(c.Request.Context(), c.Param("slug"), *request.Featured)
	if err != nil {
		if err == ErrDraftCannotFeature {
			c.JSON(http.StatusBadRequest, gin.H{"message": "draft post cannot be featured"})
			return
		}

		if err == ErrFeaturedLimit {
			c.JSON(http.StatusBadRequest, gin.H{"message": "featured post limit reached (max 3)"})
			return
		}

		if err == ErrPostNotFound {
			c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update featured state"})
		return
	}

	c.JSON(http.StatusOK, post)
}

func (h *Handler) batchPosts(c *gin.Context) {
	var request BatchPostsInput

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid batch payload"})
		return
	}

	affected, err := h.service.BatchPosts(c.Request.Context(), request.Action, request.Slugs)
	if err != nil {
		if err == ErrInvalidBatchAction {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid batch action or empty selection"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to apply batch operation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "batch operation applied",
		"affected": affected,
	})
}

func (h *Handler) exportPDF(c *gin.Context) {
	var request PDFExportInput

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid pdf export payload"})
		return
	}

	pdfBytes, fileName, err := buildPostPDF(request, PDFRenderOptions{
		MediaDir:     h.mediaDir,
		MediaURLPath: h.mediaURLPath,
	})
	if err != nil {
		if err == ErrInvalidPost {
			c.JSON(http.StatusBadRequest, gin.H{"message": "title, body or publishedAt is invalid"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to export pdf"})
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Header("Content-Disposition", pdfContentDisposition(fileName))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

func (h *Handler) importHTMLDocument(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "html file is required"})
		return
	}

	if !isHTMLDocumentFileName(fileHeader.Filename) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "only .html or .htm files are supported"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to open html file"})
		return
	}
	defer file.Close()

	contents, err := io.ReadAll(io.LimitReader(file, maxHTMLImportBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to read html file"})
		return
	}

	if len(contents) > maxHTMLImportBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "html file is too large"})
		return
	}

	imported, err := parseHTMLImportDocument(fileHeader.Filename, string(contents))
	if err != nil {
		if err == ErrInvalidPost {
			c.JSON(http.StatusBadRequest, gin.H{"message": "html content is empty or invalid"})
			return
		}

		c.JSON(http.StatusBadRequest, gin.H{"message": "failed to import html file"})
		return
	}

	c.JSON(http.StatusOK, imported)
}

func (h *Handler) deletePost(c *gin.Context) {
	err := h.service.DeletePost(c.Request.Context(), c.Param("slug"))
	if err != nil {
		if err == ErrPostNotFound {
			c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to delete post"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "post deleted"})
}
