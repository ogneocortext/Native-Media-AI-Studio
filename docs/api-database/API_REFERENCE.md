# API Reference Database

**Version:** 1.0.0  
**Base URL:** `/api`  
**Last Updated:** 2026-08-24

## Overview

This document provides a comprehensive reference for all API endpoints in the Native Media AI Studio backend. It is designed for both AI agents and developers to understand and interact with the API.

---

## Authentication

No authentication required for local development.

---

## Content Types

| Type | Value |
|------|-------|
| Request | `application/json` |
| Response | `application/json` |
| File Upload | `multipart/form-data` |

---

## Endpoints

### Health

#### GET `/api/health`
Get overall system health status.

**Response:**
```json
{
  "status": "healthy",
  "adapters": {
    "backend": { "status": "online", "response_time_ms": 45 },
    "comfyui": { "status": "online", "response_time_ms": 120 }
  },
  "timestamp": "2026-08-24T17:58:00Z"
}
```

---

### Audio

#### POST `/api/audio/upload`
Upload an audio file for music video creation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file | file | Yes | Audio file (MP3, WAV, FLAC, OGG, M4A, WMA, AAC) |

**Constraints:**
- Max file size: 500 MB
- Allowed extensions: .mp3, .wav, .flac, .ogg, .m4a, .wma, .aac

**Response:**
```json
{
  "success": true,
  "filename": "my_song.mp3",
  "stored_path": "D:/.../output/audio/85a406ef_my_song.mp3",
  "size_bytes": 5242880,
  "message": "Audio file uploaded successfully (5120 KB)"
}
```

#### POST `/api/audio/analyze`
Analyze audio file for tempo, beats, sections, and energy curve.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file | file | Yes | Audio file to analyze |

**Response:**
```json
{
  "tempo_bpm": 128.5,
  "duration_seconds": 210.3,
  "beat_count": 448,
  "sections": [
    { "type": "intro", "start": 0.0, "end": 25.5, "energy": 0.35 },
    { "type": "verse", "start": 25.5, "end": 51.0, "energy": 0.55 },
    { "type": "chorus", "start": 51.0, "end": 76.5, "energy": 0.85 }
  ],
  "beat_times": [0.5, 0.97, 1.44],
  "energy_curve": [0.12, 0.15, 0.18],
  "confidence": 0.92,
  "job_id": "85a406ef"
}
```

#### GET `/api/audio/files`
List all uploaded audio files.

**Response:**
```json
{
  "files": [
    {
      "filename": "85a406ef_my_song.mp3",
      "size_bytes": 5242880,
      "modified": 1724534400.0,
      "path": "D:/.../output/audio/85a406ef_my_song.mp3"
    }
  ]
}
```

#### GET `/api/audio/file/{filename}`
Serve an audio file by filename (supports streaming).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| filename | string | Yes | Audio filename (URL-encoded) |

**Headers:**
- `Accept-Ranges: bytes`
- `Cache-Control: public, max-age=3600`

#### GET `/api/audio/analysis/{job_id}`
Get analysis result by job ID.

---

### Jobs

#### GET `/api/jobs`
List all jobs with optional filtering.

**Query Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| status | string | No | Filter by status: pending, running, completed, failed |
| limit | integer | No | Maximum number of jobs to return |

#### GET `/api/jobs/{job_id}`
Get job details by ID.

#### DELETE `/api/jobs/{job_id}`
Cancel or delete a job.

---

### Outputs

#### GET `/api/outputs`
List all output files.

**Query Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_type | string | No | Filter by type: image, video, audio |
| limit | integer | No | Maximum number of files |

#### GET `/api/outputs/{filename}`
Serve an output file.

#### DELETE `/api/outputs/{filename}`
Delete an output file.

---

### Integrations

#### GET `/api/integrations`
List all integration statuses.

---

### ComfyUI

#### GET `/api/comfyui/status`
Get ComfyUI server status.

#### POST `/api/comfyui/generate`
Submit a generation request.

### CUDA Audio Analysis

#### GET `/api/integrations/cuda/status`
Get CUDA toolkit status and GPU information.

**Response:**
```json
{
  "available": true,
  "gpu_name": "NVIDIA GeForce GTX 1070 Ti",
  "cuda_version": "release 12.2",
  "error": ""
}
```

#### POST `/api/integrations/cuda/analyze`
Perform CUDA-accelerated audio frequency analysis.

**Request:**
```json
{
  "audio_url": "http://localhost:5173/api/audio/file/song.mp3",
  "sample_rate": 44100
}
```

**Response:**
```json
{
  "source": "cuda",
  "bass": 0.75,
  "mid": 0.62,
  "treble": 0.45,
  "overall": 0.68,
  "gpu_used": true
}
```

---

### Video

#### POST `/api/video/generate-section`
Generate a video section.

---

### Logs

#### GET `/api/logs`
Get system logs.

**Query Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| level | string | No | Log level filter: debug, info, warning, error |
| limit | integer | No | Maximum number of entries |

---

### Docs

#### GET `/api/docs/structure`
Get documentation structure.

#### GET `/api/docs/bootstrap`
Get documentation bootstrap data.

---

## WebSocket

**Path:** `/ws`  
**Protocol:** WebSocket

### Events

| Event | Description | Payload |
|-------|-------------|---------|
| job_update | Job status updates | `{ job_id, status, progress }` |
| health_update | Health status changes | `{ status, adapters }` |
| log_entry | New log entries | `{ timestamp, level, message }` |

---

## Error Handling

**Format:**
```json
{
  "detail": "Error message",
  "status_code": 500
}
```

**Common Errors:**
| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters or file type |
| 404 | Not Found - Resource does not exist |
| 413 | Payload Too Large - File exceeds size limit |
| 500 | Internal Server Error - Processing failed |
| 503 | Service Unavailable - Required dependency missing |

---

## Usage Examples

### Upload Audio
```javascript
const formData = new FormData();
formData.append('file', audioFile);
const res = await fetch('/api/audio/upload', {
  method: 'POST',
  body: formData
});
const data = await res.json();
```

### Analyze Audio
```javascript
const formData = new FormData();
formData.append('file', audioFile);
const res = await fetch('/api/audio/analyze', {
  method: 'POST',
  body: formData
});
const analysis = await res.json();
// analysis.tempo_bpm, analysis.beat_times, analysis.sections
```

### Get Audio File URL
```javascript
const filename = encodeURIComponent('my_song.mp3');
const audioUrl = `/api/audio/file/${filename}`;
// Use in <audio src={audioUrl} />
```

---

## Agent Guidelines

### Best Practices
- Always URL-encode filenames when using them in API paths
- Handle multipart/form-data for file uploads (don't set Content-Type header manually)
- Check job status before attempting to retrieve results
- Use WebSocket for real-time updates instead of polling when possible
- Cache analysis results to avoid re-analyzing the same file

### Rate Limiting
No rate limiting for local development.

### Retry Strategy
Exponential backoff for 5xx errors, max 3 retries.