FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts vite.config.ts index.html ./
COPY src ./src
COPY apps ./apps
COPY packages ./packages
COPY public ./public
COPY resources ./resources
COPY skills ./skills
COPY extensions ./extensions
COPY tests ./tests
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-venv libgl1 libglib2.0-0 libgomp1 util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public
COPY --from=build /app/resources ./resources
COPY --from=build /app/skills ./skills
COPY --from=build /app/extensions ./extensions
COPY --from=build /app/apps/video-worker ./apps/video-worker

# Remote image/video generation works without this optional local processing runtime.
ARG WITH_VIDEO_RUNTIME=1
RUN if [ "$WITH_VIDEO_RUNTIME" = "1" ]; then \
      python3 -m venv /opt/studio-video && \
      /opt/studio-video/bin/pip install --no-cache-dir -r apps/video-worker/requirements.txt && \
      /opt/studio-video/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base', revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66', local_dir='/opt/studio-video/model')"; \
    fi
ENV NODE_ENV=production \
    STUDIO_DATA=/data \
    STUDIO_LOCK_MANAGED=1 \
    STUDIO_PYTHON=/opt/studio-video/bin/python \
    STUDIO_WHISPER_MODEL=/opt/studio-video/model
RUN mkdir -p /data
EXPOSE 4310
CMD ["flock", "-F", "-n", "/data/server.flock", "node", "dist-server/index.js"]
