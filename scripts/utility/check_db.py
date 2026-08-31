import sqlite3
import os

db_path = r'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend\storage\studio.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print('=== TABLES ===')
    for t in tables:
        print(f'  {t[0]}')
    print('\n=== ROW COUNTS ===')
    for t in tables:
        cursor.execute(f'SELECT COUNT(*) FROM {t[0]}')
        count = cursor.fetchone()[0]
        print(f'  {t[0]}: {count} rows')
    print('\n=== SCHEMA ===')
    for t in tables:
        cursor.execute(f'PRAGMA table_info({t[0]})')
        columns = cursor.fetchall()
        print(f'\n  {t[0]}:')
        for col in columns:
            print(f'    {col[1]} ({col[2]})')
    conn.close()
else:
    print('Database not found')
