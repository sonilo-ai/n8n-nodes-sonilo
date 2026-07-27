# Changelog

## 0.1.2

Republish of 0.1.1 with no code changes — 0.1.1 was published manually
without an npm provenance attestation, which n8n's node verification
requires. This version is published only through the GitHub Actions
workflow so it carries a valid provenance statement.

## 0.1.1

Fixes to match the real Sonilo API contract (the earlier `0.1.0` release was
built against a public OpenAPI spec that turned out to be wrong in several
places).

- **Breaking (internal):** every generation request is now sent as
  `multipart/form-data` instead of JSON. The API's routes declare all fields
  as form fields and never accepted a JSON body, so `0.1.0` requests to
  `text-to-music`, `video-to-music`, `text-to-sfx`, and `video-to-sfx` would
  not have worked against the live API.
- Task polling (`GET /v1/tasks/{task_id}`) now treats `succeeded` as the
  success terminal state instead of `completed`, and no longer special-cases
  a `canceled` state that doesn't exist.
- `mode` and `output_format` (`m4a` default, or `wav`) are now sent only on
  the music operations. The Sound Effect operations send a separate
  `audio_format` field (`wav`/`mp3`/`aac`/`flac`, no default) instead, and no
  longer send `mode` at all — those endpoints are unconditionally async.
- `segments` is now JSON-encoded into a single form field instead of sent as
  a nested array, matching the form-encoded request body.
- `duration` limits corrected: 5–360 seconds for Text to Music, 1–180 seconds
  for Text to Sound Effects.

## 0.1.0

Initial release.

- `Sonilo` node with `Music` (Text to Music, Video to Music) and `Sound Effect`
  (Text to Sound Effects, Video to Sound Effects) resources/operations.
- `Sonilo API` credential (Bearer token authentication).
- Automatic polling of `GET /v1/tasks/{task_id}` when a generation call
  returns an async task, with configurable poll interval/timeout and an
  option to skip waiting and return the task ID immediately.
- Video operations accept a `video_url`; direct binary video upload is not
  yet supported.
