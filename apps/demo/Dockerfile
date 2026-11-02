# Stage 1: Build the frontend
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/demo/ ./apps/demo/

RUN pnpm install --frozen-lockfile
RUN ./node_modules/.bin/tsc -b packages/workspace packages/python packages/runtime
RUN pnpm --filter demo build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY apps/demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/demo/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
