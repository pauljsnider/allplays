import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function isIdentifierStart(character) {
    return /[A-Za-z_]/.test(character || '');
}

function isIdentifierCharacter(character) {
    return /[A-Za-z0-9_$]/.test(character || '');
}

function minifyFirestoreRulesSource(rulesSource) {
    let result = '';
    let quote = '';
    let escaped = false;
    let inLineComment = false;
    let pendingWhitespace = false;

    for (let index = 0; index < rulesSource.length; index += 1) {
        const character = rulesSource[index];
        const nextCharacter = rulesSource[index + 1];

        if (inLineComment) {
            if (character === '\n') {
                inLineComment = false;
                pendingWhitespace = true;
            }
            continue;
        }

        if (quote) {
            result += character;
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = '';
            }
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            pendingWhitespace = false;
            result += character;
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (/\s/.test(character)) {
            pendingWhitespace = true;
            continue;
        }

        if (pendingWhitespace && result) {
            const previousCharacter = result[result.length - 1];
            if (
                (isIdentifierCharacter(previousCharacter) && isIdentifierCharacter(character))
                || (isIdentifierCharacter(previousCharacter) && character === '/')
            ) {
                result += ' ';
            }
        }

        pendingWhitespace = false;
        result += character;
    }

    return result;
}

function collectFirestoreRuleFunctionNames(rulesSource) {
    const names = [];
    let quote = '';
    let escaped = false;

    for (let index = 0; index < rulesSource.length; index += 1) {
        const character = rulesSource[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = '';
            }
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }

        if (!rulesSource.startsWith('function ', index)) continue;
        const nameStart = index + 'function '.length;
        if (!isIdentifierStart(rulesSource[nameStart])) continue;
        let nameEnd = nameStart + 1;
        while (isIdentifierCharacter(rulesSource[nameEnd])) nameEnd += 1;
        if (rulesSource[nameEnd] !== '(') continue;
        names.push(rulesSource.slice(nameStart, nameEnd));
        index = nameEnd - 1;
    }

    return names;
}

function shortenFirestoreRuleFunctionNames(rulesSource) {
    const names = collectFirestoreRuleFunctionNames(rulesSource);
    const replacements = new Map(names.map((name, index) => [name, `f${index.toString(36)}`]));
    let result = '';
    let quote = '';
    let escaped = false;

    for (let index = 0; index < rulesSource.length;) {
        const character = rulesSource[index];
        if (quote) {
            result += character;
            index += 1;
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = '';
            }
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            result += character;
            index += 1;
            continue;
        }

        if (!isIdentifierStart(character)) {
            result += character;
            index += 1;
            continue;
        }

        let identifierEnd = index + 1;
        while (isIdentifierCharacter(rulesSource[identifierEnd])) identifierEnd += 1;
        const identifier = rulesSource.slice(index, identifierEnd);
        const previousCharacter = result[result.length - 1] || '';
        const replacement = replacements.get(identifier);
        if (
            replacement
            && rulesSource[identifierEnd] === '('
            && previousCharacter !== '.'
            && previousCharacter !== '$'
        ) {
            result += replacement;
        } else {
            result += identifier;
        }
        index = identifierEnd;
    }

    return result;
}

export function compactFirestoreRules(rulesSource) {
    const minified = minifyFirestoreRulesSource(rulesSource);
    return `${shortenFirestoreRuleFunctionNames(minified)}\n`;
}

function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error('Usage: node scripts/compact-firestore-rules.mjs <input> <output>');
    }

    writeFileSync(outputPath, compactFirestoreRules(readFileSync(inputPath, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
