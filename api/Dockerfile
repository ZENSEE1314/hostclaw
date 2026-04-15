FROM node:22-slim

WORKDIR /app/api

COPY api/package*.json ./
RUN npm install --omit=dev

WORKDIR /app
COPY . .

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

WORKDIR /app/api
CMD ["node", "server.js"]