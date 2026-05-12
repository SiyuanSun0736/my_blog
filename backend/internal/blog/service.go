package blog

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

const postsCollectionName = "posts"
const subscriptionsCollectionName = "subscriptions"

var ErrInvalidSubscriptionEmail = errors.New("invalid subscription email")

type Service struct {
	client                 *mongo.Client
	collection             *mongo.Collection
	subscriptionCollection *mongo.Collection
}

func NewService(ctx context.Context, mongoURI string, databaseName string) (*Service, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		return nil, err
	}

	service := &Service{
		client:                 client,
		collection:             client.Database(databaseName).Collection(postsCollectionName),
		subscriptionCollection: client.Database(databaseName).Collection(subscriptionsCollectionName),
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

func (s *Service) Subscribe(ctx context.Context, email string) (bool, string, error) {
	normalizedEmail, err := normalizeSubscriptionEmail(email)
	if err != nil {
		return false, "", err
	}

	result, err := s.subscriptionCollection.UpdateOne(
		ctx,
		bson.D{{Key: "email", Value: normalizedEmail}},
		bson.D{{Key: "$setOnInsert", Value: bson.D{
			{Key: "email", Value: normalizedEmail},
			{Key: "createdAt", Value: time.Now().UTC()},
		}}},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		return false, "", err
	}

	return result.UpsertedCount > 0, normalizedEmail, nil
}

func (s *Service) initialize(ctx context.Context) error {
	if err := s.client.Ping(ctx, readpref.Primary()); err != nil {
		return err
	}

	if err := s.ensureIndexes(ctx); err != nil {
		return err
	}

	return s.seedPosts(ctx)
}

func (s *Service) ensureIndexes(ctx context.Context) error {
	if _, err := s.collection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}

	_, err := s.subscriptionCollection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true),
	})

	return err
}

func (s *Service) seedPosts(ctx context.Context) error {
	count, err := s.collection.CountDocuments(ctx, bson.D{})
	if err != nil {
		return err
	}

	if count > 0 {
		return nil
	}

	posts := defaultPosts()
	documents := make([]interface{}, 0, len(posts))

	for _, post := range posts {
		documents = append(documents, post)
	}

	if _, err := s.collection.InsertMany(ctx, documents); err != nil {
		return fmt.Errorf("seed posts: %w", err)
	}

	return nil
}

func normalizeSubscriptionEmail(email string) (string, error) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return "", ErrInvalidSubscriptionEmail
	}

	if _, err := mail.ParseAddress(normalizedEmail); err != nil {
		return "", ErrInvalidSubscriptionEmail
	}

	return normalizedEmail, nil
}
