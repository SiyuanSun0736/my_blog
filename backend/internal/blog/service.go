package blog

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

const postsCollectionName = "posts"

var ErrInvalidPost = errors.New("invalid post")

type Service struct {
	client     *mongo.Client
	collection *mongo.Collection
}

func NewService(ctx context.Context, mongoURI string, databaseName string) (*Service, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		return nil, err
	}

	service := &Service{
		client:     client,
		collection: client.Database(databaseName).Collection(postsCollectionName),
	}

	if err := service.initialize(ctx); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}

	return service, nil
}

func (s *Service) Close() {
	_ = s.client.Disconnect(context.Background())
}

func (s *Service) ListPosts(ctx context.Context) ([]Post, error) {
	cursor, err := s.collection.Find(
		ctx,
		bson.D{},
		options.Find().
			SetProjection(bson.D{{Key: "body", Value: 0}}).
			SetSort(bson.D{{Key: "publishedAt", Value: -1}, {Key: "id", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	posts := make([]Post, 0)
	for cursor.Next(ctx) {
		var post Post
		if err := cursor.Decode(&post); err != nil {
			return nil, err
		}

		posts = append(posts, post)
	}

	return posts, cursor.Err()
}

func (s *Service) GetPostBySlug(ctx context.Context, slug string) (Post, bool, error) {
	var post Post

	err := s.collection.FindOne(ctx, bson.D{{Key: "slug", Value: slug}}).Decode(&post)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return Post{}, false, nil
		}

		return Post{}, false, err
	}

	return post, true, nil
}

func (s *Service) CreatePost(ctx context.Context, input CreatePostInput) (Post, error) {
	normalized, err := normalizeCreatePostInput(input)
	if err != nil {
		return Post{}, err
	}

	nextID, err := s.nextPostID(ctx)
	if err != nil {
		return Post{}, err
	}

	slug, err := s.reserveSlug(ctx, normalized.Slug)
	if err != nil {
		return Post{}, err
	}

	post := Post{
		ID:          nextID,
		Slug:        slug,
		Title:       normalized.Title,
		Summary:     normalized.Summary,
		Category:    normalized.Category,
		Tags:        normalized.Tags,
		Author:      normalized.Author,
		PublishedAt: normalized.PublishedAt,
		ReadMinutes: estimateReadMinutes(normalized.Body),
		Featured:    normalized.Featured,
		Accent:      normalized.Accent,
		Body:        normalized.Body,
	}

	if _, err := s.collection.InsertOne(ctx, post); err != nil {
		return Post{}, err
	}

	return post, nil
}

func (s *Service) initialize(ctx context.Context) error {
	if err := s.client.Ping(ctx, readpref.Primary()); err != nil {
		return err
	}

	return s.ensureIndexes(ctx)
}

func (s *Service) ensureIndexes(ctx context.Context) error {
	if _, err := s.collection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}

	return nil
}

func (s *Service) nextPostID(ctx context.Context) (int, error) {
	var post Post
	err := s.collection.FindOne(
		ctx,
		bson.D{},
		options.FindOne().SetSort(bson.D{{Key: "id", Value: -1}}).SetProjection(bson.D{{Key: "id", Value: 1}}),
	).Decode(&post)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return 1, nil
		}

		return 0, err
	}

	return post.ID + 1, nil
}

func (s *Service) reserveSlug(ctx context.Context, rawSlug string) (string, error) {
	base := rawSlug
	if base == "" {
		base = fmt.Sprintf("post-%d", time.Now().UTC().Unix())
	}

	candidate := base
	for index := 2; ; index++ {
		count, err := s.collection.CountDocuments(ctx, bson.D{{Key: "slug", Value: candidate}})
		if err != nil {
			return "", err
		}

		if count == 0 {
			return candidate, nil
		}

		candidate = fmt.Sprintf("%s-%d", base, index)
	}
}

func normalizeCreatePostInput(input CreatePostInput) (CreatePostInput, error) {
	title := strings.TrimSpace(input.Title)
	body := strings.TrimSpace(input.Body)
	if title == "" || body == "" {
		return CreatePostInput{}, ErrInvalidPost
	}

	publishedAt := strings.TrimSpace(input.PublishedAt)
	if publishedAt == "" {
		publishedAt = time.Now().UTC().Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", publishedAt); err != nil {
		return CreatePostInput{}, ErrInvalidPost
	}

	tags := make([]string, 0, len(input.Tags))
	seenTags := make(map[string]struct{}, len(input.Tags))
	for _, tag := range input.Tags {
		normalizedTag := strings.TrimSpace(tag)
		if normalizedTag == "" {
			continue
		}

		if _, exists := seenTags[normalizedTag]; exists {
			continue
		}

		seenTags[normalizedTag] = struct{}{}
		tags = append(tags, normalizedTag)
	}

	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		summary = summarizeMarkdown(body)
	}

	return CreatePostInput{
		Slug:        normalizeSlug(input.Slug, title),
		Title:       title,
		Summary:     summary,
		Category:    fallback(strings.TrimSpace(input.Category), "Wanderlust Notes"),
		Tags:        tags,
		Author:      fallback(strings.TrimSpace(input.Author), "Wanderlust"),
		PublishedAt: publishedAt,
		Featured:    input.Featured,
		Accent:      fallback(strings.TrimSpace(input.Accent), "linear-gradient(135deg, #0f766e 0%, #f59e0b 100%)"),
		Body:        body,
	}, nil
}

func normalizeSlug(rawSlug string, fallbackTitle string) string {
	base := strings.TrimSpace(rawSlug)
	if base == "" {
		base = fallbackTitle
	}

	var builder strings.Builder
	lastDash := false
	for _, char := range strings.ToLower(base) {
		switch {
		case unicode.IsLetter(char) || unicode.IsDigit(char):
			builder.WriteRune(char)
			lastDash = false
		case char == '-' || char == '_' || unicode.IsSpace(char):
			if builder.Len() > 0 && !lastDash {
				builder.WriteRune('-')
				lastDash = true
			}
		}
	}

	return strings.Trim(builder.String(), "-")
}

func summarizeMarkdown(markdown string) string {
	plain := markdownPlainText(markdown)
	if plain == "" {
		return ""
	}

	runes := []rune(plain)
	if len(runes) <= 80 {
		return plain
	}

	return strings.TrimSpace(string(runes[:80])) + "..."
}

func estimateReadMinutes(markdown string) int {
	plain := markdownPlainText(markdown)
	runeCount := utf8.RuneCountInString(plain)
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

func markdownPlainText(markdown string) string {
	plain := strings.TrimSpace(markdown)
	if plain == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"\r", " ",
		"\n", " ",
		"#", " ",
		"*", " ",
		"_", " ",
		"`", " ",
		">", " ",
		"-", " ",
	)
	plain = replacer.Replace(plain)
	linkPattern := regexp.MustCompile(`\[(.*?)\]\((.*?)\)`)
	plain = linkPattern.ReplaceAllString(plain, "$1")
	spacePattern := regexp.MustCompile(`\s+`)
	plain = spacePattern.ReplaceAllString(strings.TrimSpace(plain), " ")

	return plain
}

func fallback(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}

	return value
}
