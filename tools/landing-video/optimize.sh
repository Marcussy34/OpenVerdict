#!/usr/bin/env bash
set -euo pipefail

input_path="${1:-}"
output_dir="${2:-public/media/landing}"
fade_seconds="${3:-1.0}"

if [[ -z "$input_path" || ! -f "$input_path" ]]; then
  echo "Usage: pnpm media:landing:optimize <raw.mp4> [output-dir] [crossfade-seconds]" >&2
  exit 2
fi

for media_tool in ffmpeg ffprobe; do
  if ! command -v "$media_tool" >/dev/null 2>&1; then
    echo "$media_tool is required but was not found." >&2
    exit 2
  fi
done

duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$input_path")"
read -r middle_end seam_end loop_duration motion_last_frame <<EOF
$(awk -v duration="$duration" -v fade="$fade_seconds" 'BEGIN {
  if (fade <= 0 || duration <= (2 * fade)) exit 2
  frame = 1 / 24
  loop_duration = duration - fade + frame
  # The appended seam frame makes the last zero-based camera frame exactly
  # (duration - fade) * 24, so sin/cos complete one closed cycle there.
  last_frame = int((duration - fade) * 24 + 0.5)
  printf "%.6f %.6f %.6f %d\n", duration - fade, fade + frame, loop_duration, last_frame
}')
EOF

if [[ -z "${middle_end:-}" || -z "${seam_end:-}" || -z "${loop_duration:-}" || -z "${motion_last_frame:-}" ]]; then
  echo "Crossfade must be positive and shorter than half of the source duration." >&2
  exit 2
fi

mkdir -p "$output_dir"
mp4_path="$output_dir/openverdict-core.mp4"
webm_path="$output_dir/openverdict-core.webm"
poster_path="$output_dir/openverdict-core-poster.jpg"

# Rotate the cut point into the source, then bridge tail -> head. A final copy
# of the first source frame makes the browser's decoded loop boundary exact.
# The camera then completes one periodic push/pan cycle over those exact frames.
loop_filter="[0:v]fps=24,format=yuv420p,split=4[mid_src][tail_src][head_src][seam_src];\
[mid_src]trim=start=${fade_seconds}:end=${middle_end},setpts=PTS-STARTPTS[mid];\
[tail_src]trim=start=${middle_end}:end=${duration},setpts=PTS-STARTPTS[tail];\
[head_src]trim=start=0:end=${fade_seconds},setpts=PTS-STARTPTS[head];\
[seam_src]trim=start=${fade_seconds}:end=${seam_end},setpts=PTS-STARTPTS[seam];\
[tail][head]blend=all_expr='A*(1-T/${fade_seconds})+B*(T/${fade_seconds})':shortest=1[cross];\
[mid][cross][seam]concat=n=3:v=1:a=0[looped];\
[looped]zoompan=\
z='1.025+0.04*(0.5-0.5*cos(2*PI*on/${motion_last_frame}))':\
x='iw/2-(iw/zoom/2)+12*sin(2*PI*on/${motion_last_frame})':\
y='ih/2-(ih/zoom/2)-6*(0.5-0.5*cos(2*PI*on/${motion_last_frame}))':\
d=1:s=1920x1080:fps=24,format=yuv420p[outv]"

ffmpeg -hide_banner -loglevel warning -y -i "$input_path" \
  -filter_complex "$loop_filter" -map "[outv]" -an \
  -c:v libx264 -preset slow -crf "${H264_CRF:-27}" -profile:v high \
  -pix_fmt yuv420p -movflags +faststart "$mp4_path"

ffmpeg -hide_banner -loglevel warning -y -i "$input_path" \
  -filter_complex "$loop_filter" -map "[outv]" -an \
  -c:v libvpx-vp9 -deadline good -cpu-used 2 -row-mt 1 -tile-columns 2 \
  -frame-parallel 1 -crf "${VP9_CRF:-42}" -b:v 0 "$webm_path"

# The poster comes from the actual loop's first frame, avoiding a flash on play.
ffmpeg -hide_banner -loglevel warning -y -i "$mp4_path" -frames:v 1 \
  -update 1 -c:v mjpeg -q:v 2 -pix_fmt yuvj420p "$poster_path"

frame_count="$(ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of default=nk=1:nw=1 "$mp4_path")"
last_frame="$((frame_count - 1))"
ssim_log="$(ffmpeg -hide_banner -i "$mp4_path" -filter_complex \
  "[0:v]split=2[first_src][last_src];\
   [first_src]select='eq(n,0)',setpts=PTS-STARTPTS[first];\
   [last_src]select='eq(n,${last_frame})',setpts=PTS-STARTPTS[last];\
   [first][last]ssim" -an -f null - 2>&1)"
seam_ssim="$(printf '%s\n' "$ssim_log" | sed -n 's/.*All:\([0-9.]*\).*/\1/p' | tail -1)"

printf 'Created %s (%.3fs, %s bytes)\n' "$mp4_path" "$loop_duration" "$(wc -c < "$mp4_path" | tr -d ' ')"
printf 'Created %s (%.3fs, %s bytes)\n' "$webm_path" "$loop_duration" "$(wc -c < "$webm_path" | tr -d ' ')"
printf 'Created %s\n' "$poster_path"
printf 'First/last-frame SSIM: %s (1.0 is identical)\n' "${seam_ssim:-unavailable}"
