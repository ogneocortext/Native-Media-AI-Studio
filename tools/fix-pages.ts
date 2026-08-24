import fs from 'fs';
import path from 'path';

console.log('🔧 Fixing frontend pages...');

const pagesDir = path.join(process.cwd(), 'apps/frontend/src/pages');
const pageFiles = [
  'UnifiedHomeDashboard.tsx',
  'UnifiedMediaLibrary.tsx',
  'StatusPage.tsx',
  'VideoWorkspace.tsx',
  'UnifiedAudioUniverse.tsx',
  'CharacterStudio.tsx'
];

pageFiles.forEach(file => {
  const filePath = path.join(pagesDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Fix import statements with missing commas
    content = content.replace(/import\s*{\s*([^}]*)\s*}\s*from\s*["']([^"']+)["']/g, (match, imports, module) => {
      const fixedImports = imports.trim()
        .split(/\s+/)
        .filter(i => i.length > 0)
        .map(i => i.trim().replace(/,+$/, ''))
        .filter(i => i.length > 0 && i !== ',')
        .join(',\n  ');
      return `import {\n  ${fixedImports}\n} from "${module}"`;
    });
    
    // Fix object literals with missing commas
    content = content.replace(/:\s*string;?,/g, ': string;');
    content = content.replace(/:\s*string;(\s*\n)/g, ': string,$1');
    content = content.replace(/:\s*number;?,/g, ': number;');
    content = content.replace(/:\s*number;(\s*\n)/g, ': number,$1');
    content = content.replace(/:\s*boolean;?,/g, ': boolean;');
    content = content.replace(/:\s*boolean;(\s*\n)/g, ': boolean,$1');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed ${file}`);
  }
});

console.log('\n✅ All pages fixed! Now run npm run build');