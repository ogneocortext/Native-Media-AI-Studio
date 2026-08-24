import sqlite3
import os

DB_PATH = r'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend\storage\studio.db'

def fix_database():
    """Fix database issues and clean up test data."""
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("=== DATABASE FIXES ===\n")
    
    # 1. Check integrity
    cursor.execute('PRAGMA integrity_check')
    integrity = cursor.fetchone()[0]
    print(f"1. Integrity check: {integrity}")
    
    # 2. Clean up test data with placeholder paths
    print("\n2. Cleaning test data...")
    cursor.execute("DELETE FROM audio_files WHERE stored_path LIKE '/path/%'")
    audio_deleted = cursor.rowcount
    print(f"   Deleted {audio_deleted} test audio files")
    
    cursor.execute("DELETE FROM ai_visuals WHERE stored_path LIKE '/path/%'")
    visual_deleted = cursor.rowcount
    print(f"   Deleted {visual_deleted} test visuals")
    
    cursor.execute("DELETE FROM prompts WHERE name = 'Test Prompt'")
    prompt_deleted = cursor.rowcount
    print(f"   Deleted {prompt_deleted} test prompts")
    
    # 3. Fix orphaned foreign keys
    print("\n3. Fixing orphaned foreign keys...")
    cursor.execute("""
        UPDATE jobs SET params = '{}' 
        WHERE params LIKE '%audio_id%' AND params NOT IN (
            SELECT id FROM audio_files
        )
    """)
    jobs_fixed = cursor.rowcount
    print(f"   Fixed {jobs_fixed} orphaned job references")
    
    # 4. Add missing indexes for performance
    print("\n4. Adding missing indexes...")
    indexes = [
        ("idx_jobs_retry", "CREATE INDEX IF NOT EXISTS idx_jobs_retry ON jobs(retry_count)"),
        ("idx_audio_bpm", "CREATE INDEX IF NOT EXISTS idx_audio_bpm ON audio_files(bpm)"),
        ("idx_audio_genre", "CREATE INDEX IF NOT EXISTS idx_audio_genre ON audio_files(genre)"),
        ("idx_sessions_created", "CREATE INDEX IF NOT EXISTS idx_sessions_created ON generation_sessions(created_at)"),
        ("idx_tracks_title", "CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title)"),
        ("idx_visuals_prompt", "CREATE INDEX IF NOT EXISTS idx_visuals_prompt ON ai_visuals(prompt_id)"),
    ]
    for name, sql in indexes:
        try:
            cursor.execute(sql)
            print(f"   Created index: {name}")
        except sqlite3.OperationalError as e:
            print(f"   Index {name}: {e}")
    
    # 5. Update schema version
    print("\n5. Updating schema version...")
    cursor.execute("UPDATE schema_version SET value = 4, updated_at = datetime('now') WHERE id = 1")
    print("   Schema version updated")
    
    # 6. Vacuum to reclaim space
    print("\n6. Vacuuming database...")
    cursor.execute("VACUUM")
    print("   Vacuum complete")
    
    # 7. Final stats
    print("\n=== FINAL STATS ===")
    tables = ['jobs', 'audio_files', 'prompts', 'ai_visuals', 'generation_sessions', 'user_preferences', 'tracks']
    for table in tables:
        cursor.execute(f'SELECT COUNT(*) FROM {table}')
        count = cursor.fetchone()[0]
        print(f"   {table}: {count} rows")
    
    conn.commit()
    conn.close()
    print("\n=== FIXES COMPLETE ===")

if __name__ == "__main__":
    fix_database()
