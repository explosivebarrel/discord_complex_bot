#!/bin/sh
# Gate the youtube plugin on YouTube reachability: the plugin crashes the
# whole Lavalink at boot when youtube.com is unreachable (it makes a
# network call while the player manager builds), so this supervisor runs
# the same TLS probe and only starts Lavalink with the plugin enabled
# when the probe passes. Spring resolves the verdict into
# plugins.youtube.enabled (application.yml). Lavalink restarts only when
# the verdict flips or the process dies on its own; a restart drops
# players for a few seconds and wavelink reconnects by itself.
set -u

PROBE_URL="${PROBE_URL:-https://www.youtube.com}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-10}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"
BOOT_GRACE="${BOOT_GRACE:-30}"

probe() { curl -s -o /dev/null --max-time "$PROBE_TIMEOUT" "$PROBE_URL"; }

verdict=false
java_pid=""

stop_java() {
  [ -n "$java_pid" ] || return 0
  kill "$java_pid" 2>/dev/null
  wait "$java_pid" 2>/dev/null
  java_pid=""
}

start_java() {
  # Render the real config from the mounted template with the probe
  # verdict baked in — the plugin config section does not go through
  # Spring placeholder resolution, so the marker is replaced here.
  sed "s/@@YOUTUBE_ENABLED@@/$verdict/" /opt/Lavalink/application.yml.template > /opt/Lavalink/application.yml
  java -jar Lavalink.jar &
  java_pid=$!
  echo "[supervise] youtube reachable=$verdict, starting Lavalink (pid $java_pid)"
}

trap 'stop_java; exit 0' TERM INT

# Background sleep + wait: a trapped TERM interrupts wait immediately,
# while a plain sleep would delay docker stop by up to the interval.
sleep_quiet() {
  sleep "$1" &
  wait $!
}

while true; do
  if probe; then new=true; else new=false; fi
  alive=false
  if [ -n "$java_pid" ] && kill -0 "$java_pid" 2>/dev/null; then alive=true; fi
  if [ "$new" != "$verdict" ] || [ "$alive" = false ]; then
    echo "[supervise] youtube reachable=$new (was $verdict), lavalink alive=$alive"
    stop_java
    verdict=$new
    start_java
    # A network that died between probes crashes an enabled plugin right
    # after boot; re-probe once during the grace window instead of staying
    # down for the whole interval.
    sleep_quiet "$BOOT_GRACE"
    if ! kill -0 "$java_pid" 2>/dev/null; then
      wait "$java_pid" 2>/dev/null
      echo "[supervise] Lavalink exited right after boot"
      java_pid=""
      if probe; then new=true; else new=false; fi
      if [ "$new" != "$verdict" ]; then
        verdict=$new
        start_java
      fi
    fi
  fi
  sleep_quiet "$CHECK_INTERVAL"
done
