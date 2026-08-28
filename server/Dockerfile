# Church 2.0 API - production image
FROM node:22-alpine

WORKDIR /app

# Install production deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY src ./src

# AI engine used by the /api/v1/ai endpoints (repo root, shared with the frontend)
COPY ai-engine.js ./

ENV NODE_ENV=production
EXPOSE 4000

# Small init so SIGTERM reaches node for graceful shutdown
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# Run migrations, then start the API
CMD ["sh", "-c", "node src/db/migrate.js && node src/index.js"]

