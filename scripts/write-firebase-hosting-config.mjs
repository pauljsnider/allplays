import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(scriptDir, '..');
const firebaseHostingSite = 'game-flow-c6311';
const appAssetsCacheHeader = {
    key: 'Cache-Control',
    value: 'public, max-age=31536000, immutable'
};

function toHostingPath(filePath, publicDir) {
    return `/${path.relative(publicDir, filePath).split(path.sep).join('/')}`;
}

function listAppAssetHeaderRules(publicDir) {
    const appAssetsDir = path.join(publicDir, 'app', 'assets');
    if (!fs.existsSync(appAssetsDir)) {
        return [];
    }

    const assetPaths = [];
    const visit = (currentDir) => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
            } else if (entry.isFile()) {
                assetPaths.push(toHostingPath(entryPath, publicDir));
            }
        }
    };

    visit(appAssetsDir);

    return assetPaths.sort().map((source) => ({
        source,
        headers: [appAssetsCacheHeader]
    }));
}

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
        site: config.hosting?.site ?? firebaseHostingSite,
        public: path.resolve(publicDir),
        headers: [
            ...(config.hosting?.headers ?? []),
            ...listAppAssetHeaderRules(path.resolve(publicDir))
        ]
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
