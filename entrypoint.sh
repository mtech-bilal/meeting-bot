#!/bin/bash
set -e

# Start Xvfb virtual display on :99
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Start PulseAudio in daemon mode, never exit on idle
pulseaudio --daemonize --exit-idle-time=-1 --allow-exit=false

# Small delay to ensure PulseAudio is ready before creating sinks
sleep 1

# Create a virtual null audio sink — browser sends meeting audio here
pactl load-module module-null-sink \n  sink_name=Virtual_Speaker \n  sink_properties=device.description="Virtual_Speaker"

# Set it as the system default so Chromium outputs to it automatically
pactl set-default-sink Virtual_Speaker

# Loopback module allows FFmpeg to capture the sink's monitor source
pactl load-module module-loopback

# Hand off to the container CMD (node src/bot.js <url>)
exec "$@"
