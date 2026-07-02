FROM oven/bun:1.3.14 AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src
RUN bun run build

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src

CMD ["bun", "src/cli/index.ts", "trajectory", "registry", "serve", "--hosted"]
