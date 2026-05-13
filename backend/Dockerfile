FROM golang:1.23-alpine AS builder

ARG BLOG_API_BUILD_GOMEMLIMIT=120MiB
ARG BLOG_API_BUILD_GOGC=50
ARG BLOG_API_BUILD_P=1

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOMAXPROCS=${BLOG_API_BUILD_P} GOMEMLIMIT=${BLOG_API_BUILD_GOMEMLIMIT} GOGC=${BLOG_API_BUILD_GOGC} \
	go build -p=${BLOG_API_BUILD_P} -trimpath -o /out/blog-api .

FROM alpine:3.21

RUN adduser -D -u 10001 appuser \
	&& mkdir -p /app/media \
	&& chown -R appuser:appuser /app

COPY --from=builder /out/blog-api /usr/local/bin/blog-api

USER appuser

EXPOSE 8080

ENTRYPOINT ["blog-api"]