# ── Stage 1: Build / install dependencies ─────────────────────────────────
# Use alpine for smaller image size. Pin the version for reproducible builds.
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first — Docker layer cache means npm install
# only re-runs if package.json or package-lock.json changes
COPY package*.json ./

# Install ALL deps (including dev) for the build stage
RUN npm ci --frozen-lockfile

COPY . .

# ── Stage 2: Production image ──────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001

WORKDIR /app

# Copy only production node_modules from builder stage
COPY package*.json ./
RUN npm ci --frozen-lockfile --only=production && \
    npm cache clean --force

# Copy app source
COPY --from=builder /app/src ./src

# Fix ownership
RUN chown -R nodeapp:nodejs /app
USER nodeapp

# K8s best practices:
#   - Expose non-privileged port (3000)
#   - Use SIGTERM for graceful shutdown (handled in index.js)
EXPOSE 3000

# Health check — K8s liveness probe will also call /health,
# but this gives Docker Compose visibility too
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "src/index.js"]