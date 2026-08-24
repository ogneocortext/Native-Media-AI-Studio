import fs from 'fs';
import path from 'path';

console.log('🧹 Cleaning corrupted frontend files...');

const frontendDir = path.join(process.cwd(), 'apps/frontend/src');
const badFile = path.join(frontendDir, 'components/media/MediaLibraryPanel.tsx');

if (fs.existsSync(badFile)) {
  fs.unlinkSync(badFile);
  console.log(`✅ Removed corrupted file: ${badFile}`);
}

// Clean any remaining temp/fix scripts
const cleanupFiles = [
  'fix-pages.ts',
  'fix-all-errors.cjs',
  'fix-object-commas.cjs',
  'apps/frontend/fix-all-errors.cjs',
  'apps/frontend/fix-all-errors.js',
  'apps/frontend/fix-object-commas.cjs'
];

cleanupFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`✅ Cleaned up: ${file}`);
  }
});

console.log('\n✅ All corrupted files cleaned!');