FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

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