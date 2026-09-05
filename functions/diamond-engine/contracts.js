"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiamondDomainError = exports.DIAMOND_STAT_CATALOG_VERSION = exports.DIAMOND_REDUCER_VERSION = exports.DIAMOND_SCHEMA_VERSION = void 0;
exports.DIAMOND_SCHEMA_VERSION = 2;
exports.DIAMOND_REDUCER_VERSION = 1;
exports.DIAMOND_STAT_CATALOG_VERSION = 1;
class DiamondDomainError extends Error {
    constructor(code, message, retryable = false) {
        super(message);
        this.name = 'DiamondDomainError';
        this.code = code;
        this.retryable = retryable;
    }
}
exports.DiamondDomainError = DiamondDomainError;
