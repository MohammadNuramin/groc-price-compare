# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim

WORKDIR /app

# Chromium runtime dependencies (CloakBrowser ships its own binary but needs these libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 libxshmfence1 libglib2.0-0 fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV CLOAKBROWSER_CACHE_DIR=/app/.cloakbrowser

EXPOSE 3000

CMD ["npm", "run", "dev"]
