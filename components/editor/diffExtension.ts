import { StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import type { MutableRefObject } from 'react';

export interface DiffEdit {
  id: string;
  search: string;
  replace: string;
}

export interface DiffCallbacks {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

export const setDiffEdits = StateEffect.define<DiffEdit[]>();

export const diffEditsField = StateField.define<DiffEdit[]>({
  create: () => [],
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffEdits)) return e.value;
    }
    return val;
  },
});

class DiffWidget extends WidgetType {
  constructor(
    private readonly edit: DiffEdit,
    private readonly callbacksRef: MutableRefObject<DiffCallbacks>
  ) {
    super();
  }

  eq(other: DiffWidget) {
    return (
      other.edit.id === this.edit.id && other.edit.replace === this.edit.replace
    );
  }

  toDOM() {
    // Use inline styles for layout so CodeMirror's inherited white-space:pre
    // and other cm-content rules cannot break the flex layout.
    const wrap = document.createElement('div');
    wrap.className = 'cm-diff-widget';
    wrap.style.cssText = [
      'white-space: normal',
      'display: flex',
      'flex-direction: column',
      'border-radius: 6px',
      'overflow: hidden',
      'border: 1px solid var(--color-border-strong)',
      'margin: 3px 0 2px',
      'font-family: inherit',
      'font-size: inherit',
      'line-height: inherit',
      'user-select: none',
    ].join(';');

    const makeRow = (sign: string, content: string, cls: string) => {
      const row = document.createElement('div');
      row.className = cls;
      row.style.cssText = [
        'display: flex',
        'align-items: flex-start',
        'gap: 8px',
        'padding: 5px 10px',
        'white-space: normal',
      ].join(';');

      const signEl = document.createElement('span');
      signEl.className = 'cm-diff-sign';
      signEl.textContent = sign;
      signEl.style.cssText =
        'flex-shrink: 0; font-weight: 700; font-size: 13px; line-height: 1.5; width: 14px; text-align: center';
      row.appendChild(signEl);

      const textEl = document.createElement('span');
      textEl.textContent = content;
      textEl.style.cssText =
        'flex: 1; white-space: pre-wrap; line-height: inherit';
      row.appendChild(textEl);

      return row;
    };

    // ── Before row ────────────────────────────────────────────────
    const beforeRow = makeRow('−', this.edit.search, 'cm-diff-before');
    wrap.appendChild(beforeRow);

    // ── After row ─────────────────────────────────────────────────
    const afterRow = makeRow('+', this.edit.replace, 'cm-diff-after');

    const actions = document.createElement('div');
    actions.style.cssText =
      'display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding-top: 2px';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'cm-diff-accept-btn';
    acceptBtn.textContent = '✓ Accept';
    acceptBtn.title = 'Accept';
    acceptBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.callbacksRef.current.onAccept(this.edit.id);
    });
    actions.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'cm-diff-reject-btn';
    rejectBtn.textContent = '✕ Reject';
    rejectBtn.title = 'Reject';
    rejectBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.callbacksRef.current.onReject(this.edit.id);
    });
    actions.appendChild(rejectBtn);

    afterRow.appendChild(actions);
    wrap.appendChild(afterRow);

    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * Find `search` in `doc`, trying exact match first then a few normalizations.
 * Returns [from, to] in the ORIGINAL doc, or null if not found.
 */
function findMatch(doc: string, search: string): [number, number] | null {
  // 1. Exact
  let idx = doc.indexOf(search);
  if (idx !== -1) return [idx, idx + search.length];

  // 2. Normalize CRLF → LF (AI may emit \r\n even though the editor uses \n)
  const docLF = doc.replace(/\r\n/g, '\n');
  const searchLF = search.replace(/\r\n/g, '\n');
  if (searchLF !== search) {
    idx = docLF.indexOf(searchLF);
    if (idx !== -1) {
      // Map position back: each \r\n before idx adds 1 extra char in the original
      const crlfsBefore = (doc.slice(0, idx + 1).match(/\r\n/g) ?? []).length;
      const from = idx + crlfsBefore;
      const searchCRLFs = (search.match(/\r\n/g) ?? []).length;
      return [
        from,
        from +
          search.length +
          searchCRLFs -
          (searchLF.length - searchLF.replace(/\n/g, '').length),
      ];
    }
  }

  // 3. Trailing-whitespace-trimmed lines (AI sometimes drops trailing spaces)
  const trimLines = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n');
  const docTrimmed = trimLines(doc);
  const searchTrimmed = trimLines(search);
  if (searchTrimmed !== search) {
    idx = docTrimmed.indexOf(searchTrimmed);
    if (idx !== -1) return [idx, idx + search.length];
  }

  return null;
}

function buildDiffDecorations(
  state: import('@codemirror/state').EditorState,
  callbacksRef: MutableRefObject<DiffCallbacks>
): DecorationSet {
  const edits = state.field(diffEditsField);
  if (!edits.length) return Decoration.none;

  const doc = state.doc.toString();
  const ranges: Range<Decoration>[] = [];

  for (const edit of edits) {
    const match = findMatch(doc, edit.search);
    if (!match) continue;
    const [from, to] = match;

    ranges.push(
      Decoration.widget({
        widget: new DiffWidget(edit, callbacksRef),
        block: true,
        side: -1,
      }).range(from)
    );
  }

  // Sort by position; for ties put block widgets (to === from) before marks
  ranges.sort((a, b) =>
    a.from !== b.from ? a.from - b.from : a.to === a.from ? -1 : 1
  );

  return Decoration.set(ranges, true);
}

/**
 * Returns a StateField that computes inline diff decorations.
 * Block decorations must live in a StateField (not a ViewPlugin).
 */
export function makeDiffDecorationsField(
  callbacksRef: MutableRefObject<DiffCallbacks>
) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decos, tr) {
      const editsChanged = tr.effects.some((e) => e.is(setDiffEdits));
      if (!tr.docChanged && !editsChanged) {
        // Keep decorations mapped through any document changes
        return decos.map(tr.changes);
      }
      return buildDiffDecorations(tr.state, callbacksRef);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
