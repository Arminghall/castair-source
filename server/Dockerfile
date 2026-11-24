# CastAir server image. Build context: the repo root (scripts/deploy-server.sh).
FROM node:22-alpine
WORKDIR /app/server
# node_modules comes ready-made in the deploy tarball (scripts/deploy-server.sh),
# so the CapRover host only copies files: no npm install on the shared server.
COPY server/package.json server/package-lock.json ./
COPY server/node_modules ./node_modules
COPY server/src ./src
COPY server/data ./data
COPY web/sender /app/web/sender
COPY web/shared /app/web/shared
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "src/main.js"]
