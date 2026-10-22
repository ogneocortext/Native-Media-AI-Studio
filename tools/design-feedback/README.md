# Design Feedback System

This system enables AI-powered UI/UX analysis of the Native Media AI Studio frontend using gemma4:e2b-it-qat vision model.

## Components

1. **Standalone Script** (`design_feedback.py`)
   - Capture screenshots and analyze with gemma4:e2b-it-qat
   - Can run as HTTP server for frontend integration

2. **Backend API Router** (`apps/backend/src/api/v1/design_feedback.py`)
   - FastAPI endpoints for screenshot capture and analysis
   - Integrated with backend on port 8002

3. **Frontend Service** (`apps/frontend/src/services/designFeedbackService.ts`)
   - TypeScript service for communicating with the backend

## Installation

```bash
# Install dependencies for the design feedback system
pip install mss Pillow httpx

# Or use the requirements file
pip install -r tools/design-feedback/requirements.txt
```

## Usage

### Standalone Script

```bash
# Capture screenshot and analyze with gemma4:e2b-it-qat
python tools/design-feedback/design_feedback.py --capture

# Start HTTP server on port 8080
python tools/design-feedback/design_feedback.py --server

# Analyze an existing image
python tools/design-feedback/design_feedback.py --analyze screenshot.png
```

### Backend API

The backend provides these endpoints:
- `GET /api/v1/design-feedback/health` - Health check
- `POST /api/v1/design-feedback/capture` - Capture screenshot
- `POST /api/v1/design-feedback/analyze` - Capture and analyze

### Frontend Integration

Use the design feedback service in your React components:

```typescript
import { designFeedbackService } from "../services/designFeedbackService";

// Analyze current UI
const result = await designFeedbackService.analyzeScreenshot({
  prompt: "Focus on color contrast and accessibility",
  monitor: 1
});

if (result.success) {
  console.log(result.analysis);
}
```

## Configuration

Environment variables (all were documented here before being wired up; they
are read by the script now, not just promised):
- `OLLAMA_BASE_URL` - Ollama server URL (default: http://localhost:11434)
- `DESIGN_FEEDBACK_MODEL` - Model to use (default: gemma4:e2b-it-qat)
- `DESIGN_FEEDBACK_TIMEOUT` - Per-model request budget in seconds (default: 300 —
  cold vision-model loads on this machine measured 60-183 s)
- `DESIGN_FEEDBACK_MONITOR` - Which display to capture (default: 1; 0 = combined virtual)
- `VISION_KEEP_ALIVE` - Ollama keep-alive for the analysis model (default: 10m)
- `VISION_FALLBACK_MODELS` - Comma-separated local fallback chain tried when
  the primary model 404s (default: qwen3.5:4b)

## How It Works

1. Frontend calls the design feedback API
2. Backend captures screenshot using mss library
3. Screenshot is converted to base64 and sent to gemma4:e2b-it-qat
4. gemma4 analyzes the UI and provides feedback in JSON format
5. Frontend receives the analysis and can apply improvements

## Example Output

```json
{
  "success": true,
  "analysis": {
    "visual_design": {
      "colors": "Good contrast, consistent indigo theme",
      "spacing": "Adequate padding, could improve button spacing"
    },
    "accessibility": {
      "contrast": "Passes WCAG AA",
      "focus_states": "Visible focus indicators"
    },
    "issues": ["Small font size on secondary text"],
    "improvements": ["Increase contrast on disabled buttons"],
    "positives": ["Clean layout", "Good use of whitespace"]
  }
}
```

