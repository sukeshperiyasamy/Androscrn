# AndroScrn Camera Companion — Protocol v2

## Transport

- Phone: HTTP/1.1 over the abstract UNIX socket `androscrn_companion`. Peers must have UID 2000 (ADB shell) or 0 (root); others are closed immediately.
- PC: `adb -s <serial> forward tcp:0 localabstract:androscrn_companion` prints the chosen host port; the desktop talks to `http://127.0.0.1:<port>`.
- One request per connection (`Connection: close`). `GET` and `POST` only.
- Limits: head ≤ 8192 bytes, body ≤ 16384 bytes (`Content-Length` required for bodies; `Transfer-Encoding` rejected), 10 s read timeout, ≤ 6 concurrent connections (503 beyond).

## Versioning

`GET /api/v1/status` returns `protocolVersion`. The desktop requires exactly `2`; anything else (including v1 apps, which omit the field) yields `protocol_mismatch` and an update offer. Fields may be added without a version bump; removing or changing a field's meaning requires a bump.

## Errors

All errors are JSON: `{ "success": false, "code": "<machine code>", "error": "<human message>" }`.

| HTTP | code examples |
|---|---|
| 400 | `bad_request`, `invalid_json`, `missing_action`, `unknown_action`, `invalid_facing`, `invalid_camera_id`, `missing_camera`, `invalid_zoom`, `invalid_torch`, `invalid_photo_id` |
| 401 | `unauthorized`, `pairing_rejected` |
| 403 | `permission_required` |
| 404 | `not_found`, `camera_not_found`, `torch_unsupported`, `photo_not_found` |
| 405 | `method_not_allowed` |
| 409 | `camera_not_running` |
| 413 / 431 / 501 | oversized body / headers, chunked body |
| 429 | `too_many_challenges` |
| 503 | `busy` |
| 504 | `timeout` |

## Endpoints

### `GET /api/v1/status` (no auth)

Readiness handshake and diagnostics.

```json
{ "status": "ready", "protocolVersion": 2, "companionVersion": "1.0.0-alpha.2", "versionCode": 2,
  "state": "waiting_for_desktop", "error": "optional message",
  "deviceModel": "21091116I", "deviceProduct": "pissarroin", "androidVersion": "13", "sdkVersion": 33,
  "permissionGranted": true, "isPaired": false, "pairingPending": false,
  "cameraActive": false, "isStreaming": false, "streamClients": 0,
  "cameraId": "0", "cameraFacing": "back", "currentZoom": 1.0, "minZoom": 1.0, "maxZoom": 10.0,
  "torchOn": false, "frameWidth": 720, "frameHeight": 1280 }
```

`state` ∈ `waiting_for_desktop`, `pairing`, `connected`, `permission_required`, `camera_unavailable`, `starting_camera`, `streaming`, `stopping`, `error`. `streaming` means frames are being produced; `isStreaming` additionally requires a connected viewer.

### `POST /api/v1/pair` (no auth)

- `{}` → new challenge; the phone shows the PIN. `200 { success, message, expiresInSeconds: 60 }`. 5 challenges per 5 minutes, then `429`.
- `{ "pin": "123456" }` → `200 { success: true, token: "<64 hex>" }` or `401 pairing_rejected`. 3 wrong attempts invalidate the challenge. Token TTL 1 h; a new pairing replaces the previous token.

### Authenticated endpoints

`Authorization: Bearer <token>` (or `?token=<token>` for the stream URL used by `<img>`).

- `GET /api/v1/capabilities` → `{ protocolVersion, transport: "adb_forward_localabstract", streamFormat: "mjpeg", zoomSupported, torchSupported, snapshotsSupported, inAppPreviewSupported, minZoom, maxZoom, cameras: [{ id, facing, sensorOrientation, hasFlash, outputSizes[] }] }`
- `POST /api/v1/control` with `{ "action": ... }`:

| action | fields | success body | notes |
|---|---|---|---|
| `start_camera` | `facing?` (`front`/`back`), `cameraId?` | `{ success, action, state }` | 403 `permission_required` if not granted |
| `stop_camera` | – | `{ success, action, state }` | releases the camera |
| `set_camera` | `facing` or `cameraId` | `{ success, action }` | rebinds if running, else saved for next start |
| `set_zoom` | `ratio` (number, 0 < r ≤ 100) | `{ success, currentZoom }` | clamped to the camera's range |
| `set_torch` | `enabled` (boolean) | `{ success, torchOn }` | 404 `torch_unsupported` without flash |
| `take_photo` | – | `{ success, photoId, sizeBytes, downloadUrl }` | 5 s capture timeout |
| `disconnect` | – | `{ success, message }` | stops camera, revokes token |

Duplicate requests are idempotent in effect (`start_camera` while running rebinds; `stop_camera` while stopped succeeds).

- `GET /api/v1/photo/<photoId>` → `image/jpeg`. Each photo can be downloaded once; at most 3 are held.
- `GET /api/v1/stream` → `409 camera_not_running` unless the camera is running, else:

```
HTTP/1.1 200 OK
Content-Type: multipart/x-mixed-replace; boundary=androscrnframe

--androscrnframe
Content-Type: image/jpeg
Content-Length: <n>

<JPEG bytes>
```

Frames: JPEG (quality 70) of the upright portrait image, ~720×1280 target, ≤ 20 fps. Backpressure: the phone keeps only the newest frame, so slow readers skip frames. The stream ends when the camera stops or no frame arrives for 3 s; the desktop treats the end as "stream lost".

## Reconnection

There is no server-side session to resume besides the token. After a USB disconnect the desktop runs prepare again (new forward, new port) and, if the token is still valid, starts the camera; otherwise it pairs again.
