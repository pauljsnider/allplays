import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(scriptDir, '..');

export function writeFirebaseHostingConfig(publicDir, outputFile, { rootDir = defaultRootDir } = {}) {
    if (!publicDir) {
        throw new Error('Hosting public directory is required.');
    }
    if (!outputFile) {
        throw new Error('Output config path is required.');
    }

    const firebaseConfigPath = path.join(rootDir, 'firebase.json');
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

    config.hosting = {
        ...config.hosting,
        public: path.resolve(publicDir)
    };

    const resolvedOutputFile = path.resolve(outputFile);
    fs.mkdirSync(path.dirname(resolvedOutputFile), { recursive: true });
    fs.writeFileSync(resolvedOutputFile, `${JSON.stringify(config, null, 2)}\n`);

    return resolvedOutputFile;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [publicDir, outputFile] = process.argv.slice(2);
    const resolvedOutputFile = writeFirebaseHostingConfig(publicDir, outputFile);
    console.log(`Wrote Firebase hosting config: ${resolvedOutputFile}`);
}
