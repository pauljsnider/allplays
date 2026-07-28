const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const indexConfig = JSON.parse(readFileSync(
  join(__dirname, '..', '..', 'firestore.indexes.json'),
  'utf8'
));

function hasComposite(collectionGroup, expectedFields) {
  return indexConfig.indexes.some((index) => (
    index.collectionGroup === collectionGroup
    && index.queryScope === 'COLLECTION_GROUP'
    && expectedFields.every((expected, position) => (
      index.fields[position]?.fieldPath === expected.fieldPath
      && index.fields[position]?.order === expected.order
    ))
    && index.fields.length === expectedFields.length
  ));
}

function hasCollectionGroupFieldOrder(collectionGroup, fieldPath, order) {
  return indexConfig.fieldOverrides.some((override) => (
    override.collectionGroup === collectionGroup
    && override.fieldPath === fieldPath
    && override.indexes.some((index) => (
      index.queryScope === 'COLLECTION_GROUP' && index.order === order
    ))
  ));
}

test('homepage collection-group query shapes have deployed index definitions', () => {
  for (const collectionGroup of ['games', 'sharedGames']) {
    assert.equal(
      hasComposite(collectionGroup, [
        { fieldPath: 'liveStatus', order: 'ASCENDING' },
        { fieldPath: 'date', order: 'DESCENDING' }
      ]),
      true,
      `${collectionGroup} replay query needs liveStatus/date composite index`
    );
    assert.equal(
      hasCollectionGroupFieldOrder(collectionGroup, 'date', 'ASCENDING'),
      true,
      `${collectionGroup} upcoming query needs ascending collection-group date index`
    );
    assert.equal(
      hasCollectionGroupFieldOrder(collectionGroup, 'date', 'DESCENDING'),
      true,
      `${collectionGroup} replay query needs descending collection-group date index`
    );
  }
});
