package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"

	"inkharbor/backend/internal/blog"
)

func main() {
	blogService, err := blog.NewService(context.Background(), mongoURI(), mongoDatabase())
	if err != nil {
		log.Fatal(err)
	}
	defer blogService.Close()

	router := gin.Default()

	blogHandler := blog.NewHandler(blogService)

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := router.Group("/api")
	blogHandler.RegisterRoutes(api)

	if err := router.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}

func mongoURI() string {
	if value := os.Getenv("MONGODB_URI"); value != "" {
		return value
	}

	return "mongodb://localhost:27017"
}

func mongoDatabase() string {
	if value := os.Getenv("MONGODB_DATABASE"); value != "" {
		return value
	}

	return "inkharbor"
}
