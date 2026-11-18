# Puma Place API — production image (Render Docker Web Service).
# Local development keeps using compose.yml with a bind mount; this same
# image also serves compose because the container only needs prod deps to
# run `node src/index.js`.

# ---- deps: production-only node_modules ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- runner: minimal non-root production image ----
FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN useradd -m appuser
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY docs ./docs
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
