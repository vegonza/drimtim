FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY frontend/package.json ./
RUN bun install

COPY frontend/ .
RUN bun run build

FROM nginx:alpine

COPY frontend/nginx.traefik.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
