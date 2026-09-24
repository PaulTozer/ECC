'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__', '.venv', '.pytest_cache']);
const EXCLUDED_FILES = /^(?:\.env(?:\..*)?|secrets\.json)$|\.(?:pem|key|pyc|pyo|log)$/i;

function collectFiles(directory, relative = '') {
  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Refusing to package symbolic link directory: ${relative}`);
  }
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      if (EXCLUDED_DIRECTORIES.has(entry.name) || EXCLUDED_FILES.test(entry.name)) return [];
      const source = path.join(directory, entry.name);
      const destination = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to package symbolic link: ${destination}`);
      if (entry.isDirectory()) return collectFiles(source, destination);
      if (!entry.isFile()) throw new Error(`Refusing to package non-regular file: ${destination}`);
      return [{ source, relative: destination }];
    });
}

function collectDependencies(sourceRoot, dependencies, collected = new Map()) {
  const resolve = createRequire(path.join(sourceRoot, 'package.json'));
  return Object.keys(dependencies).sort().reduce((result, name) => {
    const directory = dependencyRoot(resolve.resolve(name), name);
    const previous = result.get(name);
    if (previous) {
      if (previous !== directory) throw new Error(`Conflicting runtime dependency versions: ${name}`);
      return result;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    return collectDependencies(directory, manifest.dependencies || {}, new Map([...result, [name, directory]]));
  }, collected);
}

function dependencyRoot(entrypoint, name) {
  let directory = path.dirname(entrypoint);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) {
      return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot locate runtime dependency manifest: ${name}`);
}

function runtimeFiles(sourceRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  const directories = ['scripts', 'skills', 'agents', 'commands', 'rules', 'hooks', 'manifests', 'schemas', 'contexts', 'config'];
  const sourceFiles = directories.flatMap(name => collectFiles(path.join(sourceRoot, name), name));
  const dependencyFiles = [...collectDependencies(sourceRoot, manifest.dependencies).entries()]
    .flatMap(([name, directory]) => collectFiles(directory, path.join('node_modules', name)));
  const rootFiles = ['package.json', 'VERSION', 'LICENSE'].map(name => {
    const source = path.join(sourceRoot, name);
    if (!fs.lstatSync(source).isFile()) throw new Error(`Expected regular source file: ${name}`);
    return { source, relative: name };
  });
  return { manifest, files: [...sourceFiles, ...dependencyFiles, ...rootFiles] };
}

module.exports = { collectFiles, collectDependencies, runtimeFiles };
