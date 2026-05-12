FROM node:20-alpine AS frontend-builder

ARG FRONTEND_BUILD_MAX_OLD_SPACE_SIZE=384
ENV NODE_OPTIONS=--max-old-space-size=${FRONTEND_BUILD_MAX_OLD_SPACE_SIZE}

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

RUN mkdir -p /etc/nginx/certs /etc/nginx/templates

COPY nginx/default.conf /etc/nginx/templates/default.conf.template
COPY nginx/04-validate-certs.sh /docker-entrypoint.d/04-validate-certs.sh
COPY nginx/05-watch-certs.sh /docker-entrypoint.d/05-watch-certs.sh
RUN chmod +x /docker-entrypoint.d/04-validate-certs.sh /docker-entrypoint.d/05-watch-certs.sh
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]