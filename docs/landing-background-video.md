# Landing background video

OpenVerdict's hero media is generated with Google Cloud, constrained into a
cycle by Veo, and then made browser-safe with FFmpeg. Only the selected poster,
MP4, and WebM belong in `public/media/landing/`; billable candidates and raw
takes stay under the ignored `artifacts/landing-video/` directory.

## Current model choice

The original proposal used `imagen-3.0-generate-002`. Google has shut down that
model and all Imagen 4 generation endpoints; its official replacement is
`gemini-3.1-flash-image` through `generateContent`. For the final art direction,
this pipeline uses Google's higher-quality GA `gemini-3-pro-image` model for
2K, 16:9 keyframes. The video stage uses the quality-first GA
`veo-3.1-generate-001` model at 1080p. Veo 3.1 supports
image-to-video, first-and-last-frame guidance, 4/6/8-second clips, 16:9, and
24 FPS. The same selected image is supplied as both the first and last frame.

The visual depicts Gonka's global decentralized inference network as a physical
kinetic instrument: a dark titanium Earth armature, ceramic compute contacts,
and real sapphire optical fibers. Five larger hardware anchors represent the
OpenVerdict jury. Sui is referenced by one restrained sapphire waterdrop plumb
weight. The fixed brand accents are `#0E76FF` and `#F3F3F3`, over the landing's
existing deep navy ground. Glass-globe and generic neon-network treatments are
explicitly excluded. Veo is directed to keep all hardware stationary and animate
only routed light inside the existing optical fibers and five anchor seams; this
minimizes geometry drift in a decorative background loop.

Primary references, checked August 28, 2026:

- [Current Google Cloud image generation guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation)
- [Gemini 3.1 Flash Image model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image)
- [Gemini 3 Pro Image model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image)
- [Google's Imagen shutdown and replacement table](https://ai.google.dev/gemini-api/docs/deprecations#imagen-models)
- [Veo 3.1 model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate)
- [Generate Veo videos from an image](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-an-image)
- [Generate with first and last frames](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-first-and-last-frames)
- [Google Cloud model pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- [Application Default Credentials setup](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/gcp-auth)
- [FFmpeg blend filter](https://ffmpeg.org/ffmpeg-filters.html#blend-1)

At the checked rates, a 2K Gemini 3 Pro Image output costs about US$0.134, so
two quality-first candidates cost about US$0.27 plus negligible text input. One
eight-second, video-only Standard Veo 3.1 take at 1080p costs about US$1.60.
Cloud Storage adds a negligible amount for these small temporary files. Pricing
can change, so review the linked table before passing `--confirm-billable`.

## One-time Cloud setup

```bash
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID
gcloud beta services identity create \
  --service=aiplatform.googleapis.com \
  --project=YOUR_PROJECT_ID
gcloud storage buckets create gs://YOUR_BUCKET --location=us-central1 \
  --uniform-bucket-level-access --project YOUR_PROJECT_ID
```

The local generator uses the official `@google/genai` Node SDK with Application
Default Credentials. No API key is stored in the repository.

## Generate and finish the media

Generate two quality-first keyframes:

```bash
pnpm media:landing keyframes \
  --project YOUR_PROJECT_ID \
  --count 2 \
  --confirm-billable
```

Inspect the candidates in `artifacts/landing-video/keyframes/`, then generate
one cyclic take from the selected image. Buy another take only when inspection
finds a concrete defect:

```bash
pnpm media:landing video \
  --project YOUR_PROJECT_ID \
  --bucket YOUR_BUCKET \
  --keyframe artifacts/landing-video/keyframes/openverdict-core-01.png \
  --takes 1 \
  --duration 8 \
  --resolution 1080p \
  --confirm-billable
```

Finish the selected take:

```bash
pnpm media:landing:optimize \
  artifacts/landing-video/raw/veo-take-01.mp4 \
  public/media/landing \
  1.0
```

The FFmpeg step does not use the common broken pattern that blends an entire
clip against its final seconds. It moves the cut one second into the source,
crossfades only the true tail against the true head, appends that bridge to the
middle, pins one exact copy of the first frame at the browser loop boundary,
then applies a closed cinematic camera cycle: a 2.5%→6.5%→2.5% push-in with a
small elliptical pan whose first and last transforms are identical. It strips
audio, emits H.264 and VP9 files, and reports first/last-frame SSIM. The poster
is extracted from the finished loop's actual first frame.

## Web outputs

- `public/media/landing/openverdict-core.webm` — primary VP9 source.
- `public/media/landing/openverdict-core.mp4` — H.264 fallback with fast start.
- `public/media/landing/openverdict-core-poster.jpg` — reduced-motion and loading fallback.
