# Shared Types

This directory contains TypeScript type definitions generated from the backend's Pydantic models.

## Purpose

These types serve as the **single source of truth** for frontend-backend communication contracts, ensuring type safety across the stack.

## Usage

### Frontend

```typescript
import { Job, JobStatus, JobType, HealthResponse } from '../shared/types';

const job: Job = {
  id: "uuid",
  job_type: JobType.IMAGE_GENERATION,
  status: JobStatus.QUEUED,
  // ...
};
```

## Regenerating Types

When backend Pydantic models change:
1. Update this file to match the new schema
2. Ensure all computed fields from Pydantic are included
3. Update WebSocket event types if new events are added

## Current Coverage

- **Job Models**: `Job`, `JobCreateRequest`, `JobUpdateRequest`, `QueueStats`
- **Enums**: `JobStatus`, `JobType`, `AdapterStatus`, `ServiceHealth`
- **Health**: `HealthResponse`, `SystemHealth`, `CpuInfo`, `MemoryInfo`, `DiskInfo`, `ResourceWarning`
- **Outputs**: `OutputFile`, `OutputsResponse`
- **WebSocket Events**: `JobEvent`, `HealthEvent`, `ResourceWarningEvent`, `QueueUpdateEvent`
- **Config**: `PortConfig`

## Guidelines Compliance

Per `Guidelines.md` section 4:
> "**shared/**: TypeScript types generated from Pydantic"
