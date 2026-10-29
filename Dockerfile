# Imagem do DeckLive (design D12): Node compila o player, Rust compila o binário
# e a imagem final leva só os dois, sobre debian:bookworm-slim.

# --- 1. Player web ---
FROM node:24-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# o `tsc --noEmit` do build confere também os testes, que leem as faixas daqui
COPY fixtures/ /build/fixtures/
RUN npm run build

# --- 2. Binário ---
# Compila no mesmo Debian da imagem final, para a glibc bater (2.36).
# O rustls usa o aws-lc-rs, que compila C: o gcc da imagem slim basta (sem cmake).
FROM rust:1.96-slim-bookworm AS server
WORKDIR /build
# Dependências numa camada própria: mudar só o código não recompila tudo.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && cargo build --release --locked \
    && rm -rf src
COPY migrations/ migrations/
COPY src/ src/
# O touch força o cargo a recompilar o crate (o COPY mantém datas antigas).
RUN touch src/main.rs src/lib.rs \
    && cargo build --release --locked \
    && strip target/release/decklive

# --- 3. Imagem final ---
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 decklive \
    && useradd --uid 10001 --gid decklive --home-dir /app --no-create-home \
        --shell /usr/sbin/nologin decklive \
    && mkdir -p /app/data \
    && chown decklive:decklive /app/data
WORKDIR /app
COPY --from=server /build/target/release/decklive /usr/local/bin/decklive
COPY --from=web /build/web/dist /app/web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
ENV DECKLIVE_DATABASE=/app/data/decklive.db \
    DECKLIVE_WEB_DIR=/app/web \
    DECKLIVE_BIND=0.0.0.0:8080
VOLUME /app/data
EXPOSE 8080
# O entrypoint acerta o dono de /app/data e roda o serviço como decklive (uid 10001).
ENTRYPOINT ["entrypoint"]
CMD ["decklive"]
