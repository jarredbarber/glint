import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveAdapter } from '../spa/storage/drive.js';

test('lists every Drive API page before returning Markdown files', async () => {
    const adapter = new DriveAdapter('folder', 'client');
    const paths: string[] = [];
    const pages = [
        { files: [{ id: 'first', name: 'First.md', modifiedTime: '1' }], nextPageToken: 'next-page' },
        { files: [{ id: 'second', name: 'Second.md', modifiedTime: '2' }] },
    ];
    Object.defineProperty(adapter, 'api', {
        value: async (path: string) => {
            paths.push(path);
            return new Response(JSON.stringify(pages.shift()));
        },
    });

    const files = await adapter.list();

    assert.deepEqual(files.map((file) => file.name), ['First.md', 'Second.md']);
    assert.match(paths[1]!, /pageToken=next-page/);
});
