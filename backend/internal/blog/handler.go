package blog

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const writeTokenEnvName = "BLOG_WRITE_TOKEN"

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(router gin.IRoutes) {
	router.GET("/posts", h.listPosts)
	router.GET("/posts/:slug", h.getPost)
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
		if err == ErrPostNotFound {
			c.JSON(http.StatusNotFound, gin.H{"message": "post not found"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update featured state"})
		return
	}

	c.JSON(http.StatusOK, post)
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
