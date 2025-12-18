FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
# Explicitly set NODE_ENV to ensure devDependencies are installed
RUN NODE_ENV=development npm ci || NODE_ENV=development npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data /app/exports

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]

