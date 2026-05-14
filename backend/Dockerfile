# syntax=docker/dockerfile:1

FROM golang:1.23-alpine AS builder

ARG BLOG_API_BUILD_GOMEMLIMIT=120MiB
ARG BLOG_API_BUILD_GOGC=50
ARG BLOG_API_BUILD_P=1
ARG BLOG_PDF_KATEX_VERSION=0.16.45

WORKDIR /src

RUN apk add --no-cache nodejs npm

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
	go mod download

COPY . ./
RUN mkdir -p /tmp/pdf-assets /out/pdf-assets \
	&& npm --prefix /tmp/pdf-assets install --omit=dev --no-package-lock katex@${BLOG_PDF_KATEX_VERSION} \
	&& cp /tmp/pdf-assets/node_modules/katex/dist/katex.min.css /out/pdf-assets/ \
	&& cp /tmp/pdf-assets/node_modules/katex/dist/katex.min.js /out/pdf-assets/
RUN --mount=type=cache,target=/go/pkg/mod \
	--mount=type=cache,target=/root/.cache/go-build \
	CGO_ENABLED=0 GOOS=linux GOMAXPROCS=${BLOG_API_BUILD_P} GOMEMLIMIT=${BLOG_API_BUILD_GOMEMLIMIT} GOGC=${BLOG_API_BUILD_GOGC} \
	go build -p=${BLOG_API_BUILD_P} -trimpath -o /out/blog-api .

FROM alpine:3.21

RUN apk add --no-cache chromium font-droid-nonlatin font-noto-cjk nss su-exec \
	&& adduser -D -u 10001 appuser \
	&& mkdir -p /app/media \
	&& chown -R appuser:appuser /app

COPY --from=builder /out/blog-api /usr/local/bin/blog-api
COPY --from=builder /out/pdf-assets /usr/local/share/blog-api/pdf-assets
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["blog-api"]