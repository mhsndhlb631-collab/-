"use client";

const dirtyEditors = new Set<string>();

export function setEditorDirty(editorId: string, dirty: boolean) {
  if (dirty) dirtyEditors.add(editorId);
  else dirtyEditors.delete(editorId);
  window.dispatchEvent(
    new CustomEvent("minhaj:dirty-state", {
      detail: { dirty: dirtyEditors.size > 0 },
    }),
  );
}

export function hasUnsavedChanges() {
  return dirtyEditors.size > 0;
}
