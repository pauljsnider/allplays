# AllPlays ChatGPT MCP service — Cloud Run container.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production deps against the committed lockfile for reproducibility.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Cloud Run injects PORT; the server reads it (defaults to 8787 locally).
EXPOSE 8787
CMD ["node", "src/server.js"]
