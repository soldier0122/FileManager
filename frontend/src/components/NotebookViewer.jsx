import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useTheme } from '../context/ThemeContext';

// ---------- nbformat helpers ----------

const joinSource = (src) => (Array.isArray(src) ? src.join('') : src || '');

// nbformat stores multi-line text as an array of lines, each keeping its "\n".
const splitSource = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  return lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l)).filter((l, i, a) => !(i === a.length - 1 && l === ''));
};

const newId = () => Math.random().toString(36).slice(2, 10);

const makeCell = (type) => ({
  cell_type: type,
  id: newId(),
  metadata: {},
  source: [],
  ...(type === 'code' ? { execution_count: null, outputs: [] } : {}),
});

const parseNotebook = (text) => {
  const nb = JSON.parse(text);
  if (!nb || typeof nb !== 'object' || !Array.isArray(nb.cells)) {
    throw new Error('Not a valid notebook: missing "cells" array');
  }
  return nb;
};

const serializeNotebook = (nb) => JSON.stringify(nb, null, 1) + '\n';

const notebookLanguage = (nb) =>
  nb?.metadata?.language_info?.name || nb?.metadata?.kernelspec?.language || 'python';

// ---------- ANSI -> HTML (tracebacks, colored stdout) ----------

const ANSI_FG = ['#3b3b3b', '#e0707a', '#7fb37a', '#e0a458', '#6a9fd8', '#b58ad8', '#5cb8b2', '#d0d0d0'];
const ANSI_FG_BRIGHT = ['#6b6f7a', '#ff8a94', '#9bd196', '#f2c27a', '#8bb8ee', '#cfa5ee', '#7dd3cd', '#ffffff'];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ansiToHtml = (input) => {
  const text = escapeHtml(input);
  let out = '';
  let open = false;
  let last = 0;
  const re = /\u001b\[([0-9;]*)m/g;
  let m;
  let style = {};
  const flush = () => {
    if (open) { out += '</span>'; open = false; }
  };
  const apply = () => {
    const css = [];
    if (style.color) css.push(`color:${style.color}`);
    if (style.bold) css.push('font-weight:700');
    if (style.underline) css.push('text-decoration:underline');
    if (css.length) { out += `<span style="${css.join(';')}">`; open = true; }
  };
  while ((m = re.exec(text)) !== null) {
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
    flush();
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) style.bold = false;
      else if (c === 24) style.underline = false;
      else if (c >= 30 && c <= 37) style.color = ANSI_FG[c - 30];
      else if (c >= 90 && c <= 97) style.color = ANSI_FG_BRIGHT[c - 90];
      else if (c === 39) delete style.color;
      else if (c === 38 && codes[i + 1] === 5) { style.color = xterm(codes[i + 2]); i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { style.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
    }
    apply();
  }
  out += text.slice(last);
  flush();
  return out;
};

const xterm = (n) => {
  if (n < 8) return ANSI_FG[n];
  if (n < 16) return ANSI_FG_BRIGHT[n - 8];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  const k = n - 16;
  const comp = (x) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${comp(Math.floor(k / 36))},${comp(Math.floor((k % 36) / 6))},${comp(k % 6)})`;
};

// ---------- Markdown + LaTeX ----------

marked.setOptions({ gfm: true, breaks: false });

// Math is pulled out before markdown runs (so "_" and "*" inside formulas
// survive) and swapped back in, rendered by KaTeX, after sanitizing.
const renderMarkdown = (md) => {
  const maths = [];
  const stash = (tex, display) => {
    maths.push({ tex, display });
    return `@@MATH${maths.length - 1}@@`;
  };
  const src = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => stash(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => stash(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => stash(t, false))
    .replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g, (_, t) => stash(t, false));

  let html = DOMPurify.sanitize(marked.parse(src), { ADD_ATTR: ['target'] });
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const { tex, display } = maths[Number(i)];
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {
      return escapeHtml(tex);
    }
  });
  return html;
};

// ---------- Syntax highlighting via the Monaco instance the app already loads ----------

const useColorized = (code, language, theme) => {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    loader.init().then((monaco) => {
      monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark');
      return monaco.editor.colorize(code, language, { tabSize: 4 });
    }).then((res) => { if (!cancelled) setHtml(res); }).catch(() => {});
    return () => { cancelled = true; };
  }, [code, language, theme]);
  return html;
};

// ---------- Rendering pieces ----------

function Highlighted({ code, language, theme }) {
  const html = useColorized(code, language, theme);
  if (html == null) return <pre className="nb-code-plain">{code}</pre>;
  return <div className="nb-code-colorized" dangerouslySetInnerHTML={{ __html: html }} />;
}

function MarkdownBlock({ source }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className="nb-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

const SAFE_HTML = { ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] };

function Output({ output }) {
  const t = output.output_type;

  if (t === 'stream') {
    const isErr = output.name === 'stderr';
    return <pre className={`nb-output-text ${isErr ? 'is-stderr' : ''}`} dangerouslySetInnerHTML={{ __html: ansiToHtml(joinSource(output.text)) }} />;
  }

  if (t === 'error') {
    const tb = (output.traceback || []).join('\n') || `${output.ename}: ${output.evalue}`;
    return <pre className="nb-output-text is-error" dangerouslySetInnerHTML={{ __html: ansiToHtml(tb) }} />;
  }

  if (t === 'execute_result' || t === 'display_data') {
    const d = output.data || {};
    // Richest representation first.
    for (const mime of ['image/png', 'image/jpeg', 'image/gif']) {
      if (d[mime]) {
        return <img className="nb-output-img" alt="output" src={`data:${mime};base64,${joinSource(d[mime]).replace(/\s/g, '')}`} />;
      }
    }
    if (d['image/svg+xml']) {
      const svg = DOMPurify.sanitize(joinSource(d['image/svg+xml']), { USE_PROFILES: { svg: true, svgFilters: true } });
      return <div className="nb-output-html" dangerouslySetInnerHTML={{ __html: svg }} />;
    }
    if (d['text/html']) {
      const html = DOMPurify.sanitize(joinSource(d['text/html']), SAFE_HTML);
      return <div className="nb-output-html" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (d['text/latex']) {
      const tex = joinSource(d['text/latex']).replace(/^\s*\$\$?|\$\$?\s*$/g, '');
      let rendered;
      try { rendered = katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { rendered = escapeHtml(tex); }
      return <div className="nb-output-html" dangerouslySetInnerHTML={{ __html: rendered }} />;
    }
    if (d['text/markdown']) {
      return <MarkdownBlock source={joinSource(d['text/markdown'])} />;
    }
    if (d['application/json']) {
      return <pre className="nb-output-text">{JSON.stringify(d['application/json'], null, 2)}</pre>;
    }
    if (d['text/plain']) {
      return <pre className="nb-output-text" dangerouslySetInnerHTML={{ __html: ansiToHtml(joinSource(d['text/plain'])) }} />;
    }
    return <div className="nb-output-unsupported">Unsupported output: {Object.keys(d).join(', ') || 'empty'}</div>;
  }

  return null;
}

function CodeCellView({ cell, language, theme }) {
  const src = joinSource(cell.source);
  const outputs = cell.outputs || [];
  const count = cell.execution_count;
  return (
    <div className="nb-cell nb-cell-code">
      <div className="nb-row">
        <div className="nb-prompt nb-prompt-in">In&nbsp;[{count ?? ' '}]:</div>
        <div className="nb-input"><Highlighted code={src} language={language} theme={theme} /></div>
      </div>
      {outputs.map((o, i) => (
        <div className="nb-row" key={i}>
          <div className="nb-prompt nb-prompt-out">
            {o.output_type === 'execute_result' ? <>Out&nbsp;[{o.execution_count ?? count ?? ' '}]:</> : ''}
          </div>
          <div className="nb-output"><Output output={o} /></div>
        </div>
      ))}
    </div>
  );
}

function NotebookView({ nb, theme }) {
  const language = notebookLanguage(nb);
  if (nb.cells.length === 0) return <div className="nb-empty">This notebook has no cells.</div>;
  return (
    <div className="nb-page">
      {nb.cells.map((cell, i) => {
        const key = cell.id || i;
        if (cell.cell_type === 'markdown') {
          return <div className="nb-cell nb-cell-markdown" key={key}><MarkdownBlock source={joinSource(cell.source)} /></div>;
        }
        if (cell.cell_type === 'code') return <CodeCellView key={key} cell={cell} language={language} theme={theme} />;
        return <div className="nb-cell nb-cell-raw" key={key}><pre className="nb-code-plain">{joinSource(cell.source)}</pre></div>;
      })}
    </div>
  );
}

// ---------- Cell editor ----------

function AutoTextarea({ value, onChange, mono, placeholder }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  const onKeyDown = (e) => {
    // Tab inserts indentation instead of leaving the field (Esc then Tab to leave).
    if (e.key === 'Tab' && !e.shiftKey && mono) {
      e.preventDefault();
      const el = e.target;
      const { selectionStart: s, selectionEnd: en } = el;
      const next = el.value.slice(0, s) + '    ' + el.value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
    }
  };
  return (
    <textarea
      ref={ref}
      className={`nb-textarea ${mono ? 'is-mono' : ''}`}
      value={value}
      placeholder={placeholder}
      spellCheck={!mono}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      rows={1}
    />
  );
}

function CellEditor({ cell, index, total, onChange, onMove, onDelete, onAddBelow, onType, onClearOutputs }) {
  const text = joinSource(cell.source);
  const outputCount = cell.outputs?.length || 0;
  return (
    <div className={`nb-edit-cell nb-edit-${cell.cell_type}`}>
      <div className="nb-edit-toolbar">
        <select className="nb-select" value={cell.cell_type} onChange={(e) => onType(index, e.target.value)}>
          <option value="code">Code</option>
          <option value="markdown">Markdown</option>
          <option value="raw">Raw</option>
        </select>
        {cell.cell_type === 'code' && outputCount > 0 && (
          <button className="nb-icon-btn" onClick={() => onClearOutputs(index)} title="Clear this cell's outputs">Clear output ({outputCount})</button>
        )}
        <span className="nb-spacer" />
        <button className="nb-icon-btn" disabled={index === 0} onClick={() => onMove(index, -1)} title="Move up">↑</button>
        <button className="nb-icon-btn" disabled={index === total - 1} onClick={() => onMove(index, 1)} title="Move down">↓</button>
        <button className="nb-icon-btn danger" onClick={() => onDelete(index)} title="Delete cell">🗑️</button>
      </div>
      <AutoTextarea
        mono={cell.cell_type !== 'markdown'}
        value={text}
        placeholder={cell.cell_type === 'markdown' ? 'Markdown…' : cell.cell_type === 'code' ? 'Code…' : 'Raw text…'}
        onChange={(v) => onChange(index, v)}
      />
      <div className="nb-add-row">
        <button className="nb-add-btn" onClick={() => onAddBelow(index, 'code')}>+ Code</button>
        <button className="nb-add-btn" onClick={() => onAddBelow(index, 'markdown')}>+ Markdown</button>
      </div>
    </div>
  );
}

// ---------- Main component ----------

const MODES = [
  { id: 'view', label: '👁️ View' },
  { id: 'edit', label: '✏️ Edit cells' },
  { id: 'json', label: '{ } JSON' },
];

export default function NotebookViewer({ filePath, initialContent, onClose, onSave }) {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState('view');
  const [raw, setRaw] = useState(initialContent);          // source of truth for the file text
  const [savedRaw, setSavedRaw] = useState(initialContent); // what is on disk
  const [isSaving, setIsSaving] = useState(false);

  // Parse once per raw change; a broken file stays usable through JSON mode.
  const parsed = useMemo(() => {
    try { return { nb: parseNotebook(raw), error: null }; } catch (e) { return { nb: null, error: e.message }; }
  }, [raw]);

  const dirty = raw !== savedRaw;
  const nb = parsed.nb;

  // If the file can't be parsed, drop into JSON mode so it can still be fixed.
  useEffect(() => {
    if (parsed.error && mode !== 'json') setMode('json');
  }, [parsed.error, mode]);

  // Warn on tab close with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const updateNb = useCallback((fn) => {
    if (!nb) return;
    const next = { ...nb, cells: nb.cells.map((c) => ({ ...c })) };
    fn(next);
    setRaw(serializeNotebook(next));
  }, [nb]);

  const setCellText = (i, text) => updateNb((n) => { n.cells[i].source = splitSource(text); });
  const moveCell = (i, d) => updateNb((n) => { const [c] = n.cells.splice(i, 1); n.cells.splice(i + d, 0, c); });
  const deleteCell = (i) => updateNb((n) => { n.cells.splice(i, 1); });
  const addCell = (i, type) => updateNb((n) => { n.cells.splice(i + 1, 0, makeCell(type)); });
  const clearOutputs = (i) => updateNb((n) => { n.cells[i].outputs = []; n.cells[i].execution_count = null; });
  const changeType = (i, type) => updateNb((n) => {
    const c = n.cells[i];
    c.cell_type = type;
    if (type === 'code') { c.outputs = c.outputs || []; c.execution_count = c.execution_count ?? null; }
    else { delete c.outputs; delete c.execution_count; }
  });
  const clearAllOutputs = () => updateNb((n) => {
    n.cells.forEach((c) => { if (c.cell_type === 'code') { c.outputs = []; c.execution_count = null; } });
  });

  const save = async () => {
    setIsSaving(true);
    try {
      await onSave(raw);
      setSavedRaw(raw);
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onClose();
  };

  const kernel = nb?.metadata?.kernelspec?.display_name || nb?.metadata?.kernelspec?.name;
  const lang = nb ? notebookLanguage(nb) : '';

  return (
    <div className="dashboard-container editor-view notebook-view">
      <div className="controls-bar" style={{ marginBottom: '10px' }}>
        <span className="nb-title">
          📓 {filePath}{dirty ? ' •' : ''}
          {nb && <span className="nb-meta">{nb.cells.length} cells{kernel ? ` · ${kernel}` : lang ? ` · ${lang}` : ''}</span>}
        </span>
        <div className="action-buttons">
          <div className="nb-mode-switch" role="tablist" aria-label="Notebook mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={`nb-mode-btn ${mode === m.id ? 'active' : ''}`}
                disabled={!nb && m.id !== 'json'}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button className="action-btn btn-secondary" onClick={requestClose}>Close</button>
          <button className="action-btn" onClick={save} disabled={isSaving || !dirty}>{isSaving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {parsed.error && (
        <div className="error-message" style={{ marginBottom: '10px' }}>
          Couldn&apos;t parse this notebook ({parsed.error}). Fix the JSON below to get the rendered view back.
        </div>
      )}

      {mode === 'view' && nb && (
        <div className="nb-scroll"><NotebookView nb={nb} theme={resolvedTheme} /></div>
      )}

      {mode === 'edit' && nb && (
        <div className="nb-scroll">
          <div className="nb-page">
            <div className="nb-edit-header">
              <button className="nb-add-btn" onClick={() => addCell(-1, 'code')}>+ Code at top</button>
              <button className="nb-add-btn" onClick={() => addCell(-1, 'markdown')}>+ Markdown at top</button>
              <span className="nb-spacer" />
              <button className="nb-add-btn" onClick={clearAllOutputs}>Clear all outputs</button>
            </div>
            {nb.cells.map((cell, i) => (
              <CellEditor
                key={cell.id || i}
                cell={cell}
                index={i}
                total={nb.cells.length}
                onChange={setCellText}
                onMove={moveCell}
                onDelete={deleteCell}
                onAddBelow={addCell}
                onType={changeType}
                onClearOutputs={clearOutputs}
              />
            ))}
            {nb.cells.length === 0 && <div className="nb-empty">No cells yet — add one above.</div>}
          </div>
        </div>
      )}

      {mode === 'json' && (
        <div className="editor-shell">
          <Editor
            height="100%"
            theme={resolvedTheme === 'light' ? 'vs' : 'vs-dark'}
            language="json"
            value={raw}
            onChange={(v) => setRaw(v ?? '')}
            options={{ minimap: { enabled: false } }}
          />
        </div>
      )}
    </div>
  );
}
