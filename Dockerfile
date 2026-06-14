FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Install virtual display, audio, and video processing tools
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    alsa-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies before copying source (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Ensure output directory exists inside image
RUN mkdir -p recordings

# Virtual display environment variable required by Chromium
ENV DISPLAY=:99

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "src/bot.js"]
