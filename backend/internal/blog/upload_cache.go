package blog

import (
	"context"
	"errors"
	"strings"

	"github.com/redis/go-redis/v9"
)

const uploadCacheKeyPrefix = "wanderlust:media:digest:"

type UploadCache interface {
	Get(ctx context.Context, digest string) (string, bool, error)
	Set(ctx context.Context, digest string, publicPath string) error
	Delete(ctx context.Context, digest string) (bool, error)
}

type noopUploadCache struct{}

func (noopUploadCache) Get(context.Context, string) (string, bool, error) {
	return "", false, nil
}

func (noopUploadCache) Set(context.Context, string, string) error {
	return nil
}

func (noopUploadCache) Delete(context.Context, string) (bool, error) {
	return false, nil
}

type RedisUploadCache struct {
	client    redis.UniversalClient
	keyPrefix string
}

func NewRedisUploadCache(client redis.UniversalClient) UploadCache {
	if client == nil {
		return noopUploadCache{}
	}

	return RedisUploadCache{
		client:    client,
		keyPrefix: uploadCacheKeyPrefix,
	}
}

func (c RedisUploadCache) Get(ctx context.Context, digest string) (string, bool, error) {
	publicPath, err := c.client.Get(ctx, c.keyPrefix+digest).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", false, nil
		}

		return "", false, err
	}

	publicPath = strings.TrimSpace(publicPath)
	if publicPath == "" {
		return "", false, nil
	}

	return publicPath, true, nil
}

func (c RedisUploadCache) Set(ctx context.Context, digest string, publicPath string) error {
	return c.client.Set(ctx, c.keyPrefix+digest, strings.TrimSpace(publicPath), 0).Err()
}

func (c RedisUploadCache) Delete(ctx context.Context, digest string) (bool, error) {
	deletedCount, err := c.client.Del(ctx, c.keyPrefix+digest).Result()
	if err != nil {
		return false, err
	}

	return deletedCount > 0, nil
}
