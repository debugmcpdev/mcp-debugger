# Stage 1: Build and bundle the TypeScript application
FROM node:20-slim AS builder

WORKDIR /app

# Add container marker
ENV MCP_CONTAINER=true
WORKDIR /workspace

# Copy package files and install ALL dependencies (including dev)
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source files
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts/

# Build TypeScript first
RUN npm run build --silent

# Bundle the application into a single file
RUN node scripts/bundle.js

# Stage 2: Create minimal runtime image
FROM python:3.11-alpine

WORKDIR /app

# Set container marker for runtime
ENV MCP_CONTAINER=true

# Install only Node.js runtime (no npm) and Python deps
RUN apk add --no-cache nodejs && \
    pip3 install --no-cache-dir debugpy>=1.8.14

# Copy the bundled application, all dist files for proxy dependencies, and package.json
COPY --from=builder /workspace/dist/ ./dist/
COPY --from=builder /workspace/package.json ./package.json

# Expose ports
EXPOSE 3000 5679

# Set the entrypoint to run the bundled application
ENTRYPOINT ["node", "dist/bundle.cjs"]

# Default command arguments
CMD ["stdio"]
