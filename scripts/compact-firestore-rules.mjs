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

function collectFirestoreRuleIdentifiers(rulesSource) {
    const identifiers = new Set();
    let quote = '';
    let escaped = false;

    for (let index = 0; index < rulesSource.length;) {
        const character = rulesSource[index];
        if (quote) {
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
            index += 1;
            continue;
        }

        if (!isIdentifierStart(character)) {
            index += 1;
            continue;
        }

        let identifierEnd = index + 1;
        while (isIdentifierCharacter(rulesSource[identifierEnd])) identifierEnd += 1;
        identifiers.add(rulesSource.slice(index, identifierEnd));
        index = identifierEnd;
    }

    return identifiers;
}

function *shortFirestoreRuleIdentifiers() {
    const firstCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
    const remainingCharacters = `${firstCharacters}0123456789`;

    // A single ASCII letter cannot collide with a Rules/CEL keyword. For longer
    // generated names, an uppercase first character keeps the candidates out of
    // the lowercase keyword namespace while still using the shortest grammar-
    // valid identifiers. Source identifiers are filtered separately below.
    for (const character of firstCharacters.slice(0, -1)) yield character;

    for (let length = 2; ; length += 1) {
        const suffixLength = length - 1;
        const suffixCount = remainingCharacters.length ** suffixLength;
        for (const firstCharacter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            for (let suffixIndex = 0; suffixIndex < suffixCount; suffixIndex += 1) {
                let encodedSuffix = '';
                let remainder = suffixIndex;
                for (let position = 0; position < suffixLength; position += 1) {
                    encodedSuffix = remainingCharacters[remainder % remainingCharacters.length] + encodedSuffix;
                    remainder = Math.floor(remainder / remainingCharacters.length);
                }
                yield firstCharacter + encodedSuffix;
            }
        }
    }
}

function shortenFirestoreRuleFunctionNames(rulesSource) {
    const names = collectFirestoreRuleFunctionNames(rulesSource);
    const reservedIdentifiers = collectFirestoreRuleIdentifiers(rulesSource);
    const candidates = shortFirestoreRuleIdentifiers();
    const replacements = new Map();
    for (const name of names) {
        let candidate;
        do {
            candidate = candidates.next().value;
        } while (reservedIdentifiers.has(candidate));
        replacements.set(name, candidate);
        reservedIdentifiers.add(candidate);
    }
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
