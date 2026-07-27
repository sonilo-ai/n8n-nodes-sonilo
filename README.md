# n8n-nodes-sonilo

This is an n8n community node. It lets you generate licensed AI music and sound
effects with [Sonilo](https://sonilo.com) in your n8n workflows.

Sonilo is an API for generating licensed music and sound effects from text
prompts or video, at `https://api.sonilo.com`.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Async generation & polling](#async-generation--polling)
[Compatibility](#compatibility)
[Limitations / not yet supported](#limitations--not-yet-supported)
[Resources](#resources)
[Version history](#version-history)

## Installation

### Self-hosted n8n

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation, or install directly:

```bash
npm install n8n-nodes-sonilo
```

### n8n Cloud

Once this node has been reviewed and approved by the n8n team, it will be
installable by searching for "Sonilo" from the **Nodes** panel. Until then,
n8n Cloud users can't install it themselves — see
[Version history](#version-history) for current status.

## Operations

The node exposes one **Resource** with two operations each:

**Music**
- **Text to Music** — `POST /v1/text-to-music`. Generate music from a text
  prompt.
- **Video to Music** — `POST /v1/video-to-music`. Generate a soundtrack
  aligned to a video, from a video URL.

**Sound Effect**
- **Text to Sound Effects** — `POST /v1/text-to-sfx`. Generate sound effects
  from a text prompt.
- **Video to Sound Effects** — `POST /v1/video-to-sfx`. Generate
  frame-accurate sound effects aligned to a video, from a video URL.

All requests are sent as `multipart/form-data` — the Sonilo API declares every
field on these endpoints as a form field, and does not accept a JSON body.

Shared parameters:

| Field | Applies to | Notes |
|---|---|---|
| Prompt | All operations | Required for the text operations (5–360s for music, 1–180s for sound effects); optional creative direction for the video operations |
| Duration (Seconds) | Text operations | Desired output length. 5–360s for Text to Music, 1–180s for Text to Sound Effects |
| Video URL | Video operations | Public or signed URL the Sonilo API can fetch |
| Segments | Video operations | Optional per-section start/end/prompt overrides, sent to the API as a single JSON-encoded `segments` form field |
| Additional Fields → Mode | Music operations only | `async` (default in this node, recommended) or `stream` (the Sonilo API's own default). Not available on the Sound Effect operations — those are unconditionally async. |
| Additional Fields → Output Format | Music operations only | `m4a` (default) or `wav`. `wav` requires Mode = Async. |
| Additional Fields → Audio Format | Sound Effect operations only | `wav`, `mp3`, `aac`, or `flac`. Optional — omit to use the Sonilo default. This is a separate field from Output Format, with different allowed values. |
| Wait for Completion | All operations | Poll until the generation finishes (default: on) |
| Poll Interval / Poll Timeout | All operations | Only used while waiting |

## Credentials

You'll need a Sonilo API key. Sign up and find your key at
[sonilo.com](https://sonilo.com).

1. In n8n, create a new credential of type **Sonilo API**.
2. Paste your API key into the **API Key** field.

The node sends it as `Authorization: Bearer <your key>` on every request to
`https://api.sonilo.com`. Credential setup includes a **Test** action that
calls `GET /v1/account/services` to confirm the key works.

## Async generation & polling

The **Text to Sound Effects** and **Video to Sound Effects** operations are
always async: the API immediately responds `202` with `{ task_id, status:
"processing" }`. The **Text to Music** and **Video to Music** operations
support both modes via **Additional Fields → Mode** — this node defaults to
`async` so long generations never hold the HTTP connection open, but can be
switched to `stream` to get a finished result back directly on the same
request.

Whenever a `{ task_id, status: "processing" }` acknowledgement comes back,
this node automatically polls `GET /v1/tasks/{task_id}` (every **Poll
Interval** seconds, up to **Poll Timeout** seconds) until the task reaches a
terminal status: `succeeded` or `failed`.

- If the task **fails**, the node throws an error containing the API's
  `error.code` / `error.message` (or, with "Continue on Fail" enabled, emits
  an item with an `error` field).
- If **Poll Timeout** is reached first, the node throws a timeout error — the
  task itself keeps running on Sonilo's side, and can be checked later via a
  separate call to `GET /v1/tasks/{task_id}`.
- Turn off **Wait for Completion** to get the raw `{ task_id, status }`
  response immediately instead, e.g. if you'd rather poll from a separate part
  of your workflow (a `Wait` node + a second `Sonilo` HTTP call, a
  sub-workflow, etc.).
- If Sonilo responds with a finished result directly (Mode = Stream on a music
  operation), the node returns it as-is.

## Compatibility

Built and tested against n8n's community node tooling
(`@n8n/node-cli` 0.40.x, `n8n-workflow` 2.31.x) as of this writing. It doesn't
depend on n8n-version-specific behavior beyond the standard programmatic node
API, so it should work with any reasonably current n8n version, but it has
only been exercised inside `n8n-node dev` locally — see
[Limitations](#limitations--not-yet-supported) below.

## Limitations / not yet supported

- **No live API testing.** This node was built and unit-tested (with mocked
  HTTP calls) without access to a live Sonilo API key, so it has **not** been
  exercised against the real `api.sonilo.com`. Request/response shapes are
  based on the Sonilo API's backend route definitions. Please report any
  mismatches you hit in real usage.
- **No binary video upload.** Video operations currently only accept a
  `video_url`; uploading a binary video file from a previous node (multipart
  `video` field) is not implemented yet. This is a planned fast-follow.
- **No Audio Ducking operation.** `POST /v1/audio-ducking` is not exposed by
  this node yet.
- **No `preserve_speech` / `isolate_vocals` / `ducking` on Video to Music.**
  The API accepts these as additional boolean fields (each requiring Mode =
  Async); this node doesn't expose them yet.
- **No "Simplify Output" toggle.** The node returns the Sonilo API response
  as-is (the full `Task` object when polled, or the immediate generation
  result otherwise) rather than a flattened/simplified shape.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Sonilo](https://sonilo.com)
- [Sonilo API reference / OpenAPI spec](https://sonilo.com/openapi.json)

## Version history

### 0.1.1

Corrected the request/response contract to match the real API:

- All generation requests are now sent as `multipart/form-data` instead of
  JSON — the API doesn't accept a JSON body on these endpoints.
- Task polling now checks for the `succeeded` terminal status (previously
  looked for `completed`, which the API never returns); there's no
  `canceled` status.
- `Mode` and `Output Format` (`m4a`/`wav`) are now scoped to the music
  operations only. The Sound Effect operations use a separate `Audio Format`
  field (`wav`/`mp3`/`aac`/`flac`) and no longer send a `mode` field, since
  they're unconditionally async.
- `Segments` is now sent as a single JSON-encoded form field, as the API
  expects, rather than a nested array.
- Duration limits corrected per operation (5–360s for Text to Music, 1–180s
  for Text to Sound Effects).

See [CHANGELOG.md](./CHANGELOG.md).

### 0.1.0

Initial release — Text to Music, Video to Music, Text to Sound Effects, and
Video to Sound Effects operations, with automatic async task polling. See
[CHANGELOG.md](./CHANGELOG.md).
