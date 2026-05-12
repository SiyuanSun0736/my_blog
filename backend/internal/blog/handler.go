package blog

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(router gin.IRoutes) {
	router.GET("/posts", h.listPosts)
	router.GET("/posts/:slug", h.getPost)
	router.POST("/subscriptions", h.createSubscription)
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

func (h *Handler) createSubscription(c *gin.Context) {
	var request subscriptionRequest

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid subscription payload"})
		return
	}

	created, email, err := h.service.Subscribe(c.Request.Context(), request.Email)
	if err != nil {
		if err == ErrInvalidSubscriptionEmail {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid email address"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to create subscription"})
		return
	}

	statusCode := http.StatusOK
	message := "这个邮箱已经在订阅列表中了。"
	if created {
		statusCode = http.StatusCreated
		message = "订阅成功，后续更新会发送到这个邮箱。"
	}

	c.JSON(statusCode, subscriptionResponse{
		Email:   email,
		Created: created,
		Message: message,
	})
}
