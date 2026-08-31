import csv
import re

with open('packages/frontend/public/track-prompts-lyrics.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    header = next(reader)
    row = next(reader)
    lyrics = row[3]
    print('Full lyrics:')
    print(repr(lyrics))
    print()
    # Check for double-double-quote pattern
    ddq = re.findall(r'""', lyrics)
    print('Double-double-quotes found:', len(ddq))
    # Check for the lyric pattern
    pattern = re.findall(r'""([^"]+)""', lyrics)
    print('Pattern matches:', pattern)
