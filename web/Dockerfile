# --- Stage 1: build the SPA ---
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -- --outDir /dist --emptyOutDir

# --- Stage 2: nginx serves the bundle and proxies /api + /extension ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /dist /usr/share/nginx/html
EXPOSE 80
