# Build from repository root:
#   docker build -f frontend/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

COPY frontend/ .

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_AUTH_PROVIDER=api

RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
