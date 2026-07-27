# Changelog

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
