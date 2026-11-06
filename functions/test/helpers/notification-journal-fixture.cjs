"use strict";
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeSnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.exists = value !== undefined;
    this._value = clone(value);
  }

  data() {
    return clone(this._value);
  }
}

class FakeReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  async get() {
    if (this.database.failReads > 0) {
      this.database.failReads -= 1;
      throw Object.assign(new Error("Injected read failure"), {
        code: "unavailable",
      });
    }
    return this.database.snapshot(this);
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }

  async get(reference) {
    return this.database.snapshot(reference);
  }

  set(reference, value) {
    this.operations.push({ kind: "set", reference, value: clone(value) });
    return this;
  }

  update(reference, value) {
    this.operations.push({ kind: "update", reference, value: clone(value) });
    return this;
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.transactionQueue = Promise.resolve();
    this.transactionCount = 0;
    this.failBeforeTransactions = new Set();
    this.failAfterTransactions = new Set();
    this.failReads = 0;
  }

  doc(path) {
    return new FakeReference(this, path);
  }

  snapshot(reference) {
    return new FakeSnapshot(reference, this.documents.get(reference.path));
  }

  apply(operations) {
    for (const operation of operations) {
      if (operation.kind === "set") {
        this.documents.set(operation.reference.path, clone(operation.value));
        continue;
      }
      const current = this.documents.get(operation.reference.path);
      if (!current) throw new Error(`Missing ${operation.reference.path}`);
      this.documents.set(operation.reference.path, {
        ...clone(current),
        ...clone(operation.value),
      });
    }
  }

  runTransaction(callback) {
    const execute = async () => {
      this.transactionCount += 1;
      const transactionNumber = this.transactionCount;
      if (this.failBeforeTransactions.has(transactionNumber)) {
        this.failBeforeTransactions.delete(transactionNumber);
        throw Object.assign(new Error("Injected pre-commit failure"), {
          code: "unavailable",
        });
      }
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.apply(transaction.operations);
      if (this.failAfterTransactions.has(transactionNumber)) {
        this.failAfterTransactions.delete(transactionNumber);
        throw Object.assign(new Error("Injected committed response failure"), {
          code: "unavailable",
        });
      }
      return result;
    };
    const pending = this.transactionQueue.then(execute, execute);
    this.transactionQueue = pending.catch(() => {});
    return pending;
  }

  read(path) {
    return clone(this.documents.get(path));
  }
}

module.exports = { FakeFirestore };
