// esbuild inlines `import x from './file.md'` as the file's text (bundle:spa
// --loader:.md=text). This ambient declaration lets tsc type it as a string.
declare module '*.md' {
    const content: string;
    export default content;
}
