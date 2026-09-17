# Gestão de Propostas HORSCH — imagem de homologação
#
# Roda o build vinext (Next.js sobre Vite p/ Workers) servido pelo runtime
# local do Cloudflare (workerd/Miniflare), com D1 e R2 simulados em disco.
# O estado do banco/arquivos fica em /app/.wrangler — monte um volume ali.
#
# Build:  docker build -t horsch-propostas:hom .
# Run:    docker run -p 3000:3000 -v propostas_state:/app/.wrangler horsch-propostas:hom

FROM node:22-bookworm-slim

# sqlite3: usado pelo scripts/bootstrap-hom.sh para aplicar as migrações
# drizzle no banco D1 simulado. curl: smoke tests / healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

RUN npx vinext build

ENV NODE_ENV=production
ENV WRANGLER_LOG_PATH=/app/.wrangler/wrangler.log

EXPOSE 3000

# IMPORTANTE: `vite preview` (não `vinext start`). O preview serve o build
# dentro do workerd com os bindings D1/R2 simulados do vite.config.ts.
# `vinext start` é um servidor Node puro: a página abre, mas todo acesso a
# banco falha com "Received protocol 'cloudflare:'".
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
