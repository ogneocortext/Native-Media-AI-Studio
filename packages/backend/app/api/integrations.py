"""
Integrations API - Main router.
Includes all sub-routers with the /api/integrations prefix.
"""

from fastapi import APIRouter

from .integrations_config import router as config_router
from .integrations_generation import router as generation_router
from .integrations_music_video import router as music_video_router
from .integrations_misc import router as misc_router

# Main router that includes all sub-routers
router = APIRouter(prefix="/api/integrations", tags=["Integrations"])

router.include_router(config_router)
router.include_router(generation_router)
router.include_router(music_video_router)
router.include_router(misc_router)
