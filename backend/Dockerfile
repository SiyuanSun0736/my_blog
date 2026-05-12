FROM golang:1.23-alpine AS builder

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/blog-api .

FROM alpine:3.21

RUN adduser -D -u 10001 appuser

USER appuser

COPY --from=builder /out/blog-api /usr/local/bin/blog-api

EXPOSE 8080

ENTRYPOINT ["blog-api"]