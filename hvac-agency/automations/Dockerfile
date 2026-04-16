FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3001

# Secrets are injected at runtime — NOT baked into the image.
#
# Production (Railway): Doppler's Railway integration syncs secrets as
# environment variables before the container starts. No Doppler CLI needed here.
#
# Local dev: run via `npm run dev` (doppler run -- node src/server.js).
#
# CI: smoke tests use dummy values and never need real secrets.
CMD ["node", "src/server.js"]
