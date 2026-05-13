package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"wanderlust/backend/internal/blog"
)

func main() {
	if os.Getenv("BLOG_REPLACE_POSTS_CONFIRM") != "1" {
		log.Fatal("set BLOG_REPLACE_POSTS_CONFIRM=1 before replacing existing posts")
	}

	ctx := context.Background()
	service, err := blog.NewService(ctx, mongoURI(), mongoDatabase())
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()

	posts, err := service.ReplaceAllPosts(ctx, engineeringPosts())
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("replaced posts: %d\n", len(posts))
	for _, post := range posts {
		fmt.Printf("- %s (%s)\n", post.Title, post.Slug)
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

	return "wanderlust"
}

func engineeringPosts() []blog.CreatePostInput {
	return []blog.CreatePostInput{}
}
