# Production image for the Node/Express backend. Runs `node index.js` directly — the npm "start"
# script uses nodemon, a dev-only file-watcher with no place in a container that should just exit
# cleanly on SIGTERM and let the orchestrator restart it.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Avatar uploads (multer.diskStorage) — mounted as a volume in docker-compose.prod.yml so they
# survive a container recreate instead of vanishing with the container's writable layer.
RUN mkdir -p /app/uploads/avatars

EXPOSE 3001

CMD ["node", "index.js"]
