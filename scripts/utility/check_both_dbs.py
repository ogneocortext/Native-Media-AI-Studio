import sqlite3
import os

# Check both databases
db_paths = [
    r'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend\storage\studio.db',
    r'D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\storage\studio.db',
]

for db_path in db_paths:
    print(f'\n{"="*60}')
    print(f'DATABASE: {db_path}')
    print(f'{"="*60}')
    
    if not os.path.exists(db_path):
        print('  NOT FOUND')
        continue
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check integrity
    cursor.execute('PRAGMA integrity_check')
    integrity = cursor.fetchone()[0]
    print(f'\nIntegrity: {integrity}')
    
    # Get tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    
    for t in tables:
        table_name = t[0]
        cursor.execute(f'SELECT COUNT(*) FROM {table_name}')
        count = cursor.fetchone()[0]
        print(f'\n  {table_name}: {count} rows')
        
        # Show sample data for small tables
        if count > 0 and count <= 5:
            cursor.execute(f'SELECT * FROM {table_name} LIMIT 3')
            rows = cursor.fetchall()
            cursor.execute(f'PRAGMA table_info({table_name})')
            columns = [col[1] for col in cursor.fetchall()]
            for row in rows:
                print(f'    {dict(zip(columns, row))}')
    
    conn.close()
