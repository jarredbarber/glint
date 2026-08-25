import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAdapter } from '../spa/storage/local.js';
import { ConflictError } from '../spa/storage/types.js';

// Minimal in-memory FileSystemDirectoryHandle stand-in. Only the surface
// LocalAdapter.write() touches is implemented.
function makeDir(files: Map<string, { lastModified: number; text: string }>) {
    return {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!files.has(name)) {
                if (opts?.create) files.set(name, { lastModified: Date.now(), text: '' });
                else throw new DOMException('not found', 'NotFoundError');
            }
            return {
                async getFile() {
                    const f = files.get(name)!;
                    return { lastModified: f.lastModified, async text() { return f.text; } };
                },
                async createWritable() {
                    return {
                        async write(c: string) { files.set(name, { lastModified: files.get(name)!.lastModified + 1, text: c }); },
                        async close() { /* noop */ },
                    };
                },
            };
        },
    };
}

function adapterWith(files: Map<string, { lastModified: number; text: string }>): LocalAdapter {
    const a = new LocalAdapter();
    (a as unknown as { dir: unknown }).dir = makeDir(files);
    return a;
}

test('local write conflicts when the file was deleted, without resurrecting it (#65)', async () => {
    const files = new Map([['a.md', { lastModified: 1000, text: 'old' }]]);
    const a = adapterWith(files);
    files.delete('a.md');
    await assert.rejects(a.write('a.md', 'new', '1000'), (e) => e instanceof ConflictError);
    assert.equal(files.has('a.md'), false, 'deleted file must not be recreated');
});

test('local write conflicts on a stale version, succeeds on a fresh one (#65)', async () => {
    const files = new Map([['a.md', { lastModified: 1000, text: 'old' }]]);
    const a = adapterWith(files);
    await assert.rejects(a.write('a.md', 'x', '999'), (e) => e instanceof ConflictError);
    const res = await a.write('a.md', 'new', '1000');
    assert.equal(files.get('a.md')!.text, 'new');
    assert.equal(res.version, '1001');
});
