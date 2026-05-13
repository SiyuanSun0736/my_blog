package main

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"wanderlust/backend/internal/blog"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	blogService, err := blog.NewService(ctx, mongoURI(), mongoDatabase())
	if err != nil {
		log.Fatal(err)
	}
	defer blogService.Close()

	redisClient := newRedisClient(ctx)
	if redisClient != nil {
		defer redisClient.Close()
	}

	router := gin.Default()
	mediaDir := blogMediaDir()
	mediaURLPath := blogMediaURLPath()
	uploadCache := blog.NewRedisUploadCache(redisClient)

	blogHandler := blog.NewHandler(blogService, blog.HandlerOptions{
		MediaDir:       mediaDir,
		MediaURLPath:   mediaURLPath,
		MaxUploadBytes: blogImageUploadMaxBytes(),
		UploadCache:    uploadCache,
	})
	startMediaCleanupLoop(ctx, blog.NewMediaCleaner(blogService, blog.MediaCleanerOptions{
		MediaDir:     mediaDir,
		MediaURLPath: mediaURLPath,
		UploadCache:  uploadCache,
	}), blogMediaCleanupInterval())

	router.StaticFS(mediaURLPath, gin.Dir(mediaDir, false))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := router.Group("/api")
	blogHandler.RegisterRoutes(api)

	if err := router.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}

func startMediaCleanupLoop(ctx context.Context, cleaner *blog.MediaCleaner, interval time.Duration) {
	if cleaner == nil {
		return
	}

	if interval <= 0 {
		log.Print("blog media cleanup disabled")
		return
	}

	go func() {
		runMediaCleanup(ctx, cleaner)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runMediaCleanup(ctx, cleaner)
			}
		}
	}()
}

func runMediaCleanup(ctx context.Context, cleaner *blog.MediaCleaner) {
	report, err := cleaner.CleanupUnusedMedia(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return
		}

		log.Printf("blog media cleanup failed: %v", err)
		return
	}

	log.Printf(
		"blog media cleanup completed: referenced=%d scanned=%d deleted=%d cache_deleted=%d",
		report.ReferencedPaths,
		report.ScannedFiles,
		report.DeletedFiles,
		report.DeletedCacheEntries,
	)
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

func blogMediaDir() string {
	if value := strings.TrimSpace(os.Getenv("BLOG_MEDIA_DIR")); value != "" {
		return value
	}

	return "./uploads"
}

func blogMediaURLPath() string {
	value := strings.TrimSpace(os.Getenv("BLOG_MEDIA_URL_PATH"))
	if value == "" {
		return "/media"
	}

	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}

	value = strings.TrimRight(value, "/")
	if value == "" {
		return "/media"
	}

	return value
}

func blogImageUploadMaxBytes() int64 {
	const defaultMaxUploadBytes = 8 * 1024 * 1024

	value := strings.TrimSpace(os.Getenv("BLOG_IMAGE_UPLOAD_MAX_BYTES"))
	if value == "" {
		return defaultMaxUploadBytes
	}

	parsedValue, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsedValue <= 0 {
		log.Printf("invalid BLOG_IMAGE_UPLOAD_MAX_BYTES %q, fallback to %d", value, defaultMaxUploadBytes)
		return defaultMaxUploadBytes
	}

	return parsedValue
}

func blogMediaCleanupInterval() time.Duration {
	const defaultInterval = 24 * time.Hour

	value := strings.TrimSpace(os.Getenv("BLOG_MEDIA_CLEANUP_INTERVAL"))
	if value == "" {
		return defaultInterval
	}

	if value == "0" || strings.EqualFold(value, "off") || strings.EqualFold(value, "false") {
		return 0
	}

	interval, err := time.ParseDuration(value)
	if err != nil || interval < 0 {
		log.Printf("invalid BLOG_MEDIA_CLEANUP_INTERVAL %q, fallback to %s", value, defaultInterval)
		return defaultInterval
	}

	return interval
}

func newRedisClient(ctx context.Context) redis.UniversalClient {
	address := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if address == "" {
		return nil
	}

	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       redisDatabase(),
	})

	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("redis unavailable, image upload dedupe disabled: %v", err)
		_ = client.Close()
		return nil
	}

	return client
}

func redisDatabase() int {
	value := strings.TrimSpace(os.Getenv("REDIS_DB"))
	if value == "" {
		return 0
	}

	parsedValue, err := strconv.Atoi(value)
	if err != nil || parsedValue < 0 {
		log.Printf("invalid REDIS_DB %q, fallback to 0", value)
		return 0
	}

	return parsedValue
}
