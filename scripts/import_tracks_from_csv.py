"""Import tracks from CSV file into the database."""
import csv
import os
import sys
import re

# Add the backend app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'packages', 'backend'))

from app.core.database import (
    init_db, save_track, get_tracks, update_track, get_track, delete_track
)

CSV_PATH = os.path.join(
    os.path.dirname(__file__), '..',
    'docs', 'track-prompts-lyrics.csv'
)


def clean_text(text: str) -> str:
    """Remove 'happyshrimp' suffix and clean up text."""
    text = re.sub(r'happyshrimp\s*$', '', text, flags=re.IGNORECASE)
    text = text.strip()
    return text


def import_tracks():
    """Import tracks from CSV file."""
    init_db()
    
    # Get existing tracks
    existing_tracks = get_tracks(limit=1000)
    
    # First, clear all existing tracks and re-import
    for t in existing_tracks:
        delete_track(t['id'])
    
    imported = 0
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            track_name = row.get('Track Name', '').strip()
            prompt = clean_text(row.get('Prompt', ''))
            lyrics = clean_text(row.get('Lyrics (key excerpt/theme)', ''))
            
            if not track_name:
                continue
            
            # Determine artist based on track name
            artist = ''
            title = track_name
            
            # Match to known artists
            if 'Signal' in track_name or 'Before the Fade' in track_name or \
               'Still I Rise' in track_name or 'Borrowed Flame' in track_name or \
               "Won't Ride" in track_name or 'Take the Crown' in track_name or \
               'Built by Fire' in track_name or 'System Override' in track_name:
                artist = 'NeoCortext'
            elif 'Learning How to Stay' in track_name:
                artist = 'NeoCortext'
            
            # Clean up title - remove parenthetical variations for matching
            clean_title = re.sub(r'\s*\([^)]*\)\s*$', '', title).strip()
            
            # Determine filename
            filename = f"{artist} - {clean_title}.mp3" if artist else f"{clean_title}.mp3"
            
            # Create track record
            track_id = save_track(
                filename=filename,
                title=title,
                artist=artist,
                music_prompt=prompt,
                lyrics=lyrics,
            )
            imported += 1
            print(f"Imported: {title} (Artist: {artist})")
    
    print(f"\nDone! Imported: {imported} tracks")
    
    # Show final state
    tracks = get_tracks(limit=100)
    print(f"\nTotal tracks in database: {len(tracks)}")
    for t in tracks:
        prompt_preview = t['music_prompt'][:60] + '...' if len(t.get('music_prompt', '')) > 60 else t.get('music_prompt', '')
        has_lyrics = 'Yes' if t.get('lyrics') else 'No'
        print(f"  - {t['artist']} - {t['title']} (Lyrics: {has_lyrics})")


if __name__ == '__main__':
    import_tracks()
