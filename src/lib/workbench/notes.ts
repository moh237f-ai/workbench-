/* ==================== Markdown note helpers ====================
   Shared by the library ("New note") and the reader ("Note from page"). */

import { putBlob, purgeFileArtifacts } from './idb';
import { uid } from './helpers';

/** Create a markdown library file and return its id. */
export async function createMdNote(opts: {
  title: string;
  content?: string;
  folderId?: string | null;
  color?: string | null;
  open?: boolean;
}): Promise<string | null> {
  const id = uid();
  try {
    await putBlob(id, new Blob([opts.content ?? ''], { type: 'text/markdown' }));
    const { useWB } = await import('./store');
    const f = useWB.getState().addFile({
      id,
      kind: 'md',
      title: opts.title,
      fileName: 'note.md',
      size: (opts.content ?? '').length,
      pageCount: 1,
      currentPage: 1,
      scrollProgress: 0,
      folderId: opts.folderId ?? null,
      color: opts.color ?? null,
    });
    if (opts.open !== false) {
      window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: id }));
    }
    return f.id;
  } catch {
    await purgeFileArtifacts(id).catch(() => undefined);
    return null;
  }
}
