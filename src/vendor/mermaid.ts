import mermaid from 'mermaid';

(globalThis as typeof globalThis & { mermaid: typeof mermaid }).mermaid = mermaid;
