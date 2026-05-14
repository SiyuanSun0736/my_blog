package blog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

const (
	postsCollectionName = "posts"
	maxFeaturedPosts    = 3
)

var (
	ErrInvalidPost        = errors.New("invalid post")
	ErrPostNotFound       = errors.New("post not found")
	ErrInvalidBatchAction = errors.New("invalid batch action")
	ErrDraftCannotFeature = errors.New("draft post cannot be featured")
	ErrFeaturedLimit      = errors.New("featured post limit reached")
)

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
	return s.listPosts(ctx, false)
}

func (s *Service) ListAdminPosts(ctx context.Context) ([]Post, error) {
	return s.listPosts(ctx, true)
}

func (s *Service) ListPostBodies(ctx context.Context) ([]string, error) {
	cursor, err := s.collection.Find(
		ctx,
		bson.D{},
		options.Find().
			SetProjection(bson.D{{Key: "body", Value: 1}, {Key: "_id", Value: 0}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	bodies := make([]string, 0)
	for cursor.Next(ctx) {
		var projection struct {
			Body string `bson:"body"`
		}

		if err := cursor.Decode(&projection); err != nil {
			return nil, err
		}

		bodies = append(bodies, projection.Body)
	}

	return bodies, cursor.Err()
}

func (s *Service) listPosts(ctx context.Context, includeDrafts bool) ([]Post, error) {
	filter := bson.D{{Key: "draft", Value: bson.D{{Key: "$ne", Value: true}}}}
	if includeDrafts {
		filter = bson.D{}
	}

	cursor, err := s.collection.Find(
		ctx,
		filter,
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

		posts = append(posts, normalizeStoredPost(post))
	}

	return posts, cursor.Err()
}

func (s *Service) GetPostBySlug(ctx context.Context, slug string) (Post, bool, error) {
	return s.getPostBySlug(ctx, slug, false)
}

func (s *Service) GetAdminPostBySlug(ctx context.Context, slug string) (Post, bool, error) {
	return s.getPostBySlug(ctx, slug, true)
}

func (s *Service) getPostBySlug(ctx context.Context, slug string, includeDrafts bool) (Post, bool, error) {
	var post Post
	filter := bson.D{{Key: "slug", Value: slug}}
	if !includeDrafts {
		filter = append(filter, bson.E{Key: "draft", Value: bson.D{{Key: "$ne", Value: true}}})
	}

	err := s.collection.FindOne(ctx, filter).Decode(&post)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return Post{}, false, nil
		}

		return Post{}, false, err
	}

	return normalizeStoredPost(post), true, nil
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
		ReadMinutes: estimateReadMinutesForBody(normalized.Body, normalized.BodyFormat),
		Draft:       normalized.Draft,
		Featured:    normalized.Featured,
		Accent:      normalized.Accent,
		BodyFormat:  normalized.BodyFormat,
		Body:        normalized.Body,
	}

	if post.Featured {
		if err := s.ensureFeaturedPostCapacity(ctx, 0); err != nil {
			return Post{}, err
		}
	}

	if _, err := s.collection.InsertOne(ctx, post); err != nil {
		return Post{}, err
	}

	return post, nil
}

func (s *Service) UpdatePost(ctx context.Context, currentSlug string, input CreatePostInput) (Post, error) {
	existingPost, found, err := s.GetAdminPostBySlug(ctx, currentSlug)
	if err != nil {
		return Post{}, err
	}

	if !found {
		return Post{}, ErrPostNotFound
	}

	normalized, err := normalizeCreatePostInput(input)
	if err != nil {
		return Post{}, err
	}

	slug, err := s.reserveSlugForPost(ctx, normalized.Slug, existingPost.ID)
	if err != nil {
		return Post{}, err
	}

	updatedPost := Post{
		ID:          existingPost.ID,
		Slug:        slug,
		Title:       normalized.Title,
		Summary:     normalized.Summary,
		Category:    normalized.Category,
		Tags:        normalized.Tags,
		Author:      normalized.Author,
		PublishedAt: normalized.PublishedAt,
		ReadMinutes: estimateReadMinutesForBody(normalized.Body, normalized.BodyFormat),
		Draft:       normalized.Draft,
		Featured:    normalized.Featured,
		Accent:      normalized.Accent,
		BodyFormat:  normalized.BodyFormat,
		Body:        normalized.Body,
	}

	if updatedPost.Featured {
		if err := s.ensureFeaturedPostCapacity(ctx, updatedPost.ID); err != nil {
			return Post{}, err
		}
	}

	result, err := s.collection.ReplaceOne(ctx, bson.D{{Key: "id", Value: existingPost.ID}}, updatedPost)
	if err != nil {
		return Post{}, err
	}

	if result.MatchedCount == 0 {
		return Post{}, ErrPostNotFound
	}

	return updatedPost, nil
}

func (s *Service) DeletePost(ctx context.Context, slug string) error {
	result, err := s.collection.DeleteOne(ctx, bson.D{{Key: "slug", Value: slug}})
	if err != nil {
		return err
	}

	if result.DeletedCount == 0 {
		return ErrPostNotFound
	}

	return nil
}

func (s *Service) SetPostFeatured(ctx context.Context, slug string, featured bool) (Post, error) {
	post, found, err := s.GetAdminPostBySlug(ctx, slug)
	if err != nil {
		return Post{}, err
	}

	if !found {
		return Post{}, ErrPostNotFound
	}

	if post.Draft && featured {
		return Post{}, ErrDraftCannotFeature
	}

	if featured {
		if err := s.ensureFeaturedPostCapacity(ctx, post.ID); err != nil {
			return Post{}, err
		}
	}

	result, err := s.collection.UpdateOne(
		ctx,
		bson.D{{Key: "id", Value: post.ID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "featured", Value: featured}}}},
	)
	if err != nil {
		return Post{}, err
	}

	if result.MatchedCount == 0 {
		return Post{}, ErrPostNotFound
	}

	post.Featured = featured
	return post, nil
}

func (s *Service) BatchPosts(ctx context.Context, action string, slugs []string) (int64, error) {
	normalizedSlugs := normalizeSlugs(slugs)
	if len(normalizedSlugs) == 0 {
		return 0, ErrInvalidBatchAction
	}

	filter := bson.D{{Key: "slug", Value: bson.D{{Key: "$in", Value: normalizedSlugs}}}}

	switch action {
	case "publish":
		result, err := s.collection.UpdateMany(
			ctx,
			filter,
			bson.D{{Key: "$set", Value: bson.D{{Key: "draft", Value: false}}}},
		)
		if err != nil {
			return 0, err
		}

		return result.MatchedCount, nil
	case "draft":
		result, err := s.collection.UpdateMany(
			ctx,
			filter,
			bson.D{{Key: "$set", Value: bson.D{{Key: "draft", Value: true}, {Key: "featured", Value: false}}}},
		)
		if err != nil {
			return 0, err
		}

		return result.MatchedCount, nil
	case "delete":
		result, err := s.collection.DeleteMany(ctx, filter)
		if err != nil {
			return 0, err
		}

		return result.DeletedCount, nil
	default:
		return 0, ErrInvalidBatchAction
	}
}

func (s *Service) ReplaceAllPosts(ctx context.Context, inputs []CreatePostInput) ([]Post, error) {
	if _, err := s.collection.DeleteMany(ctx, bson.D{}); err != nil {
		return nil, err
	}

	posts := make([]Post, 0, len(inputs))
	for _, input := range inputs {
		post, err := s.CreatePost(ctx, input)
		if err != nil {
			return nil, err
		}

		posts = append(posts, post)
	}

	return posts, nil
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

func (s *Service) reserveSlugForPost(ctx context.Context, rawSlug string, postID int) (string, error) {
	base := rawSlug
	if base == "" {
		base = fmt.Sprintf("post-%d", time.Now().UTC().Unix())
	}

	candidate := base
	for index := 2; ; index++ {
		count, err := s.collection.CountDocuments(
			ctx,
			bson.D{
				{Key: "slug", Value: candidate},
				{Key: "id", Value: bson.D{{Key: "$ne", Value: postID}}},
			},
		)
		if err != nil {
			return "", err
		}

		if count == 0 {
			return candidate, nil
		}

		candidate = fmt.Sprintf("%s-%d", base, index)
	}
}

func (s *Service) ensureFeaturedPostCapacity(ctx context.Context, keepID int) error {
	filter := bson.D{{Key: "featured", Value: true}}
	if keepID > 0 {
		filter = append(filter, bson.E{Key: "id", Value: bson.D{{Key: "$ne", Value: keepID}}})
	}

	count, err := s.collection.CountDocuments(ctx, filter)
	if err != nil {
		return err
	}

	if count >= maxFeaturedPosts {
		return ErrFeaturedLimit
	}

	return nil
}

func normalizeCreatePostInput(input CreatePostInput) (CreatePostInput, error) {
	title := strings.TrimSpace(input.Title)
	bodyFormat := normalizeBodyFormat(input.BodyFormat)
	body := sanitizeBodyContent(input.Body, bodyFormat)
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
		summary = summarizeBody(body, bodyFormat)
	}

	return CreatePostInput{
		Slug:        normalizeSlug(input.Slug, title),
		Title:       title,
		Summary:     summary,
		Category:    fallback(strings.TrimSpace(input.Category), "Wanderlust Notes"),
		Tags:        tags,
		Author:      fallback(strings.TrimSpace(input.Author), "Wanderlust"),
		PublishedAt: publishedAt,
		Draft:       input.Draft,
		Featured:    input.Featured && !input.Draft,
		Accent:      fallback(strings.TrimSpace(input.Accent), "linear-gradient(135deg, #0f766e 0%, #f59e0b 100%)"),
		BodyFormat:  bodyFormat,
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
	plain = spacePattern.ReplaceAllString(strings.TrimSpace(plain), " ")
	plain = markdownLinkPattern.ReplaceAllString(plain, "$1")

	return plain
}

func fallback(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}

	return value
}

func normalizeSlugs(slugs []string) []string {
	seen := make(map[string]struct{}, len(slugs))
	normalized := make([]string, 0, len(slugs))

	for _, slug := range slugs {
		trimmedSlug := strings.TrimSpace(slug)
		if trimmedSlug == "" {
			continue
		}

		if _, exists := seen[trimmedSlug]; exists {
			continue
		}

		seen[trimmedSlug] = struct{}{}
		normalized = append(normalized, trimmedSlug)
	}

	return normalized
}
