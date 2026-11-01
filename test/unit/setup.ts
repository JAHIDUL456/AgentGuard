import { mockVscode } from './mock-vscode';

// Inject mock into require.cache
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (path: string) {
  if (path === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};

