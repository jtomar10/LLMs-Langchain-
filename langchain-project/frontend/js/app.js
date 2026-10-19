/* ==========================================================================
   MR. JITESH AI AGENT — frontend application
   Vanilla JavaScript, no build step, no dependencies.

   Sections
     1. Configuration
     2. DOM references and small helpers
     3. State and persistence (localStorage)
     4. Safe Markdown renderer (DOM nodes only, never innerHTML)
     5. Backend client (/health and /chat)
     6. Rendering (sidebar, header, thread, notices, composer)
     7. Conversation actions
     8. Sending messages
     9. Layout, dialogs, toasts
    10. Event wiring and start-up
   ========================================================================== */

(() => {
  'use strict';

  /* ======================================================================
     1. Configuration
     ====================================================================== */

  // The FastAPI backend (started by running backend.py in VS Code).
  const API_BASE_URL = 'http://127.0.0.1:8000';

  // Must match the backend's accepted values exactly.
  const modes = ['regular', 'funny', 'fluent'];

  const MODE_LABELS = { regular: 'Regular', funny: 'Funny', fluent: 'Fluent' };

  const MAX_CHARS = 10000;               // backend: ChatRequest.message max_length
  const NEAR_LIMIT_CHARS = 9000;         // counter turns amber
  const MAX_CONVERSATIONS = 50;
  const DEFAULT_TITLE = 'New conversation';
  const STORAGE_KEY = 'mja.frontend.v1'; // never holds secrets, only chat data
  const HEALTH_INTERVAL_MS = 15000;
  const HEALTH_TIMEOUT_MS = 4000;
  const CHAT_TIMEOUT_MS = 90000;
  const TEXTAREA_MAX_HEIGHT = 208;
  const MOBILE_QUERY = '(max-width: 820px)';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ======================================================================
     2. DOM references and helpers
     ====================================================================== */

  const $ = (selector, root = document) => root.querySelector(selector);

  const dom = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    scrim: $('#scrim'),
    sidebarToggle: $('#sidebar-toggle'),
    drawerClose: $('#drawer-close'),
    newChatSide: $('#new-chat-side'),
    newChatTop: $('#new-chat-top'),
    clearChat: $('#clear-chat'),
    convList: $('#conv-list'),
    convEmpty: $('#conv-empty'),
    sideMode: $('#side-mode'),
    sideStatus: $('#side-status'),
    sideStatusDot: $('#side-status-dot'),
    convTitle: $('#conv-title'),
    headerMode: $('#header-mode'),
    statusBtn: $('#status-btn'),
    statusLabel: $('#status-label'),
    messages: $('#messages'),
    welcome: $('#welcome'),
    thread: $('#thread'),
    typing: $('#typing'),
    notices: $('#notices'),
    form: $('#composer-form'),
    input: $('#message-input'),
    send: $('#send-btn'),
    counter: $('#char-count'),
    modeInputs: document.querySelectorAll('input[name="mode"]'),
    toast: $('#toast'),
    dialog: $('#confirm-dialog'),
    dialogTitle: $('#confirm-title'),
    dialogBody: $('#confirm-body'),
    dialogOk: $('#confirm-ok'),
  };

  const mobileMq = window.matchMedia(MOBILE_QUERY);
  const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** Create an element with an optional class and text content. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Create an inline SVG icon that references the sprite in index.html. */
  function icon(name, className = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function formatClock(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatShort(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return formatClock(date.toISOString());
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function modeLabel(mode) {
    return MODE_LABELS[mode] || MODE_LABELS.regular;
  }

  /** Short sidebar title built from the first user message. */
  function makeTitle(text) {
    const clean = text
      .replace(/```[\s\S]*?```/g, ' code ')
      .replace(/[#*_`>[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return DEFAULT_TITLE;
    if (clean.length <= 44) return clean;
    const cut = clean.slice(0, 44);
    const lastSpace = cut.lastIndexOf(' ');
    const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
    return base.replace(/[.,;:!?-]+$/, '') + '…';
  }

  /* ======================================================================
     3. State and persistence
     ====================================================================== */

  const state = {
    conversations: [],     // [{ id, title, messages, sessionId, sessionMode, bootId, expired, ... }]
    activeId: null,
    mode: 'regular',
    sidebarCollapsed: false,
    drawerOpen: false,
    health: { status: 'connecting', bootId: null },
    pending: new Set(),    // conversation ids with a request in flight
  };

  function sanitizeConversation(raw) {
    if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) return null;

    const messages = raw.messages
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : uid(),
        role: m.role,
        content: m.content.slice(0, 60000),
        kind: m.kind === 'error' ? 'error' : undefined,
        mode: modes.includes(m.mode) ? m.mode : undefined,
        time: typeof m.time === 'string' ? m.time : new Date().toISOString(),
      }));

    return {
      id: raw.id,
      title: typeof raw.title === 'string' && raw.title ? raw.title.slice(0, 80) : DEFAULT_TITLE,
      messages,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId.slice(0, 100) : null,
      sessionMode: modes.includes(raw.sessionMode) ? raw.sessionMode : null,
      bootId: typeof raw.bootId === 'string' ? raw.bootId : null,
      expired: raw.expired === true,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      gen: 0, // bumped when a conversation is cleared so late replies are discarded
    };
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.conversations)) {
        state.conversations = data.conversations.map(sanitizeConversation).filter(Boolean);
      }
      if (modes.includes(data.mode)) state.mode = data.mode;
      state.sidebarCollapsed = data.sidebarCollapsed === true;
      state.activeId = typeof data.activeId === 'string' ? data.activeId : null;
    } catch (error) {
      console.warn('Saved conversations could not be read and were ignored.', error);
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          conversations: state.conversations,
          activeId: state.activeId,
          mode: state.mode,
          sidebarCollapsed: state.sidebarCollapsed,
        })
      );
    } catch (error) {
      // Storage may be full or disabled. The app keeps working in memory.
      console.warn('Conversations could not be saved.', error);
    }
  }

  /* ---- conversation accessors ---- */

  function getActive() {
    return state.conversations.find((c) => c.id === state.activeId) || null;
  }

  function createConversation() {
    const now = Date.now();
    const conv = {
      id: uid(),
      title: DEFAULT_TITLE,
      messages: [],
      sessionId: null,      // a new chat never reuses an earlier session id
      sessionMode: null,
      bootId: null,
      expired: false,
      createdAt: now,
      updatedAt: now,
      gen: 0,
    };
    state.conversations.push(conv);
    return conv;
  }

  /** Remove empty conversations except the active one. */
  function pruneEmpty() {
    state.conversations = state.conversations.filter(
      (c) => c.messages.length > 0 || c.id === state.activeId
    );
  }

  /** Keep the list bounded: drop the oldest idle conversations. */
  function pruneOld() {
    if (state.conversations.length <= MAX_CONVERSATIONS) return;
    const removable = state.conversations
      .filter((c) => c.id !== state.activeId && !state.pending.has(c.id))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (state.conversations.length > MAX_CONVERSATIONS && removable.length) {
      const victim = removable.shift();
      state.conversations = state.conversations.filter((c) => c !== victim);
    }
  }

  /** Guarantee there is a valid active conversation. */
  function ensureActive() {
    let conv = getActive();
    if (conv) return conv;

    const recent = state.conversations
      .filter((c) => c.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    conv = recent || createConversation();
    state.activeId = conv.id;
    return conv;
  }

  function touch(conv) {
    conv.updatedAt = Date.now();
  }

  /* ======================================================================
     4. Safe Markdown renderer
     Builds DOM nodes with createElement/createTextNode only. Model output is
     never parsed as HTML, so there is nothing to sanitise or inject.
     ====================================================================== */

  const RE = {
    fenceOpen: /^\s*```\s*([\w+#.-]*)\s*$/,
    fenceClose: /^\s*```\s*$/,
    heading: /^(#{1,6})\s+(.+?)\s*#*\s*$/,
    hr: /^\s*([-*_])(?:\s*\1){2,}\s*$/,
    list: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
    quote: /^\s*>\s?(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
    blank: /^\s*$/,
    inline: /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*([^\s*][^*]*?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g,
  };

  function safeUrl(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
    } catch (error) {
      /* invalid URL: fall through */
    }
    return null;
  }

  /** Inline formatting: `code`, **bold**, *italic*, [text](url). */
  function renderInline(text, parent) {
    const pattern = new RegExp(RE.inline.source, 'g');
    let last = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));

      if (match[2] !== undefined) {
        parent.appendChild(el('code', 'inline-code', match[2]));
      } else if (match[3] !== undefined || match[4] !== undefined) {
        const strong = document.createElement('strong');
        renderInline(match[3] !== undefined ? match[3] : match[4], strong);
        parent.appendChild(strong);
      } else if (match[5] !== undefined) {
        const em = document.createElement('em');
        renderInline(match[5], em);
        parent.appendChild(em);
      } else {
        const href = safeUrl(match[7]);
        if (href) {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          renderInline(match[6], link);
          parent.appendChild(link);
        } else {
          parent.appendChild(document.createTextNode(match[0]));
        }
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  /** Inline formatting that keeps single line breaks. */
  function renderInlineLines(text, parent) {
    text.split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      renderInline(line, parent);
    });
  }

  function buildCodeBlock(code, lang) {
    const wrap = el('div', 'code-block');
    const head = el('div', 'code-head');
    head.appendChild(el('span', 'code-lang', lang || 'code'));

    const copy = buildCopyButton(() => code, 'Copy code');
    head.appendChild(copy);

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    wrap.append(head, pre);
    return wrap;
  }

  function splitTableRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|')) row = row.slice(0, -1);
    return row.split('|').map((cell) => cell.trim());
  }

  function buildTable(headerLine, bodyLines) {
    const wrap = el('div', 'table-wrap');
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    splitTableRow(headerLine).forEach((cell) => {
      const th = document.createElement('th');
      renderInline(cell, th);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    bodyLines.forEach((line) => {
      const tr = document.createElement('tr');
      splitTableRow(line).forEach((cell) => {
        const td = document.createElement('td');
        renderInline(cell, td);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function makeListElement(item) {
    const list = document.createElement(item.ordered ? 'ol' : 'ul');
    if (item.ordered && item.start > 1) list.start = item.start;
    return list;
  }

  /** Build (possibly nested) lists from a flat array of parsed items. */
  function buildList(items) {
    const root = makeListElement(items[0]);
    const stack = [{ indent: items[0].indent, list: root, last: null }];

    items.forEach((item) => {
      let top = stack[stack.length - 1];

      if (item.indent > top.indent && top.last) {
        const nested = makeListElement(item);
        top.last.appendChild(nested);
        stack.push({ indent: item.indent, list: nested, last: null });
        top = stack[stack.length - 1];
      } else {
        while (stack.length > 1 && item.indent < top.indent) {
          stack.pop();
          top = stack[stack.length - 1];
        }
      }

      const li = document.createElement('li');
      renderInlineLines(item.text, li);
      // Nested lists must come after the item's own text.
      top.list.appendChild(li);
      top.last = li;
    });

    return root;
  }

  function startsBlock(line, next) {
    return (
      RE.fenceOpen.test(line) ||
      RE.heading.test(line) ||
      RE.hr.test(line) ||
      RE.list.test(line) ||
      RE.quote.test(line) ||
      (line.includes('|') && next !== undefined && RE.tableSep.test(next))
    );
  }

  /** Convert Markdown text into a DocumentFragment of safe DOM nodes. */
  function renderMarkdown(source) {
    const fragment = document.createDocumentFragment();
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (RE.blank.test(line)) { i += 1; continue; }

      // Fenced code block
      const fence = line.match(RE.fenceOpen);
      if (fence) {
        const buffer = [];
        i += 1;
        while (i < lines.length && !RE.fenceClose.test(lines[i])) { buffer.push(lines[i]); i += 1; }
        i += 1; // closing fence (or end of text)
        fragment.appendChild(buildCodeBlock(buffer.join('\n'), fence[1]));
        continue;
      }

      // Heading
      const heading = line.match(RE.heading);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 6);
        const node = document.createElement(`h${level}`);
        renderInline(heading[2], node);
        fragment.appendChild(node);
        i += 1;
        continue;
      }

      // Horizontal rule
      if (RE.hr.test(line)) {
        fragment.appendChild(document.createElement('hr'));
        i += 1;
        continue;
      }

      // Blockquote
      if (RE.quote.test(line)) {
        const buffer = [];
        while (i < lines.length && RE.quote.test(lines[i])) {
          buffer.push(lines[i].match(RE.quote)[1]);
          i += 1;
        }
        const quote = document.createElement('blockquote');
        quote.appendChild(renderMarkdown(buffer.join('\n')));
        fragment.appendChild(quote);
        continue;
      }

      // Table
      if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const header = line;
        const rows = [];
        i += 2;
        while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|')) { rows.push(lines[i]); i += 1; }
        fragment.appendChild(buildTable(header, rows));
        continue;
      }

      // List (bulleted or numbered, with indentation-based nesting)
      if (RE.list.test(line)) {
        const items = [];
        while (i < lines.length) {
          const current = lines[i];
          const parsed = current.match(RE.list);
          if (parsed) {
            const ordered = /\d/.test(parsed[2]);
            items.push({
              indent: parsed[1].replace(/\t/g, '    ').length,
              ordered,
              start: ordered ? parseInt(parsed[2], 10) : null,
              text: parsed[3],
            });
            i += 1;
          } else if (RE.blank.test(current) && i + 1 < lines.length && RE.list.test(lines[i + 1])) {
            i += 1; // blank line between items
          } else if (items.length && /^\s{2,}\S/.test(current) && !startsBlock(current, lines[i + 1])) {
            items[items.length - 1].text += `\n${current.trim()}`; // wrapped continuation
            i += 1;
          } else {
            break;
          }
        }
        fragment.appendChild(buildList(items));
        continue;
      }

      // Paragraph (single line breaks are preserved)
      const buffer = [line];
      i += 1;
      while (i < lines.length && !RE.blank.test(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
        buffer.push(lines[i]);
        i += 1;
      }
      const p = document.createElement('p');
      renderInlineLines(buffer.join('\n'), p);
      fragment.appendChild(p);
    }

    return fragment;
  }

  /* ======================================================================
     5. Backend client
     ====================================================================== */

  class ChatError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.kind = kind;     // 'network' | 'timeout' | 'http' | 'format' | 'empty'
      this.status = status; // HTTP status when kind === 'http'
    }
  }

  /** Pull a readable, bounded message out of a FastAPI error body. */
  function extractDetail(data) {
    if (!data || data.detail == null) return '';
    const { detail } = data;
    let text = '';
    if (typeof detail === 'string') {
      text = detail;
    } else if (Array.isArray(detail)) {
      text = detail
        .map((item) => (item && typeof item.msg === 'string' ? item.msg : ''))
        .filter(Boolean)
        .slice(0, 2)
        .join(' ');
    }
    return text.slice(0, 300);
  }

  function describeHttpError(status, data) {
    const detail = extractDetail(data);

    switch (status) {
      case 422:
        return `The request was not accepted${detail ? `: ${detail}` : '.'} Check your message and the selected mode, then try again.`;
      case 429:
        return `${detail || 'The Groq rate limit was reached.'} Wait a moment, then select Retry.`;
      case 502:
        return `${detail || 'The AI provider could not complete the request.'} This comes from the AI service, not your message. Select Retry in a moment.`;
      case 404:
        return `The backend returned "not found". Check that API_BASE_URL (${API_BASE_URL}) points to the MR. JITESH AI AGENT backend.`;
      default:
        return `The backend returned an unexpected error (HTTP ${status}). Check the terminal where backend.py is running for details.`;
    }
  }

  function networkMessage() {
    return (
      `Cannot reach the backend at ${API_BASE_URL}. ` +
      'Open backend.py in VS Code and select Run Python File. ' +
      'If it is already running, open this page through Live Server (http://127.0.0.1:5500), ' +
      'because the backend only allows that origin by default.'
    );
  }

  /** POST /chat with { message, mode, session_id }. */
  async function postChat(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new ChatError('timeout', 'The backend took too long to answer. Select Retry, or check the backend terminal.');
      }
      throw new ChatError('network', networkMessage());
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      /* body was not JSON */
    }

    if (!response.ok) {
      throw new ChatError('http', describeHttpError(response.status, data), response.status);
    }
    if (!data || typeof data.reply !== 'string' || typeof data.session_id !== 'string') {
      throw new ChatError('format', 'The backend replied in an unexpected format. Check that it is the MR. JITESH AI AGENT backend.');
    }
    return data;
  }

  /* ---- health check ---- */

  let healthPromise = null;

  function setHealth(status, bootId = null) {
    state.health = { status, bootId: status === 'connected' ? bootId : state.health.bootId };
    renderStatus();
    if (status === 'connected') detectExpiredSessions();
  }

  /** GET /health. Concurrent callers share one request. */
  function checkHealth({ quiet = false } = {}) {
    if (healthPromise) return healthPromise;
    if (!quiet && state.health.status !== 'connected') setHealth('connecting');

    healthPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      try {
        // Query string defeats caching without adding headers that would trigger a CORS preflight.
        const response = await fetch(`${API_BASE_URL}/health?t=${Date.now()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data || data.status !== 'healthy') throw new Error('Unexpected health payload');
        setHealth('connected', typeof data.boot_id === 'string' ? data.boot_id : null);
      } catch (error) {
        setHealth('disconnected');
      } finally {
        clearTimeout(timer);
        healthPromise = null;
      }
      return state.health;
    })();

    return healthPromise;
  }

  /**
   * The backend keeps sessions in memory. If /health reports a different boot_id
   * from the one a conversation was last answered under, the backend restarted
   * and that conversation's model memory is gone.
   * (Requires the optional boot_id line in backend.py; see README.)
   */
  function detectExpiredSessions() {
    const { bootId } = state.health;
    if (!bootId) return;
    let changed = false;
    state.conversations.forEach((conv) => {
      if (conv.sessionId && conv.bootId && conv.bootId !== bootId && !conv.expired) {
        conv.expired = true;
        changed = true;
      }
    });
    if (changed) {
      saveState();
      renderNotices();
    }
  }

  /* ======================================================================
     6. Rendering
     ====================================================================== */

  /* ---- backend status ---- */

  function renderStatus() {
    const { status } = state.health;
    const labels = { connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected' };
    const label = labels[status];
    const host = new URL(API_BASE_URL).host;

    dom.statusBtn.dataset.state = status;
    dom.statusLabel.textContent = label;
    dom.statusBtn.setAttribute('aria-label', `Backend status: ${label.toLowerCase()} (${host}). Select to check again.`);

    dom.sideStatusDot.dataset.state = status;
    dom.sideStatus.textContent = label;
  }

  /* ---- mode ---- */

  function renderMode() {
    dom.app.dataset.mode = state.mode;
    dom.headerMode.textContent = `${modeLabel(state.mode)} mode`;
    dom.sideMode.textContent = modeLabel(state.mode);
    dom.modeInputs.forEach((input) => { input.checked = input.value === state.mode; });
  }

  /* ---- sidebar ---- */

  function renderSidebar() {
    const active = getActive();
    const items = state.conversations
      .filter((c) => c.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    dom.convList.replaceChildren();
    dom.convEmpty.hidden = items.length > 0;

    items.forEach((conv) => {
      const isActive = active && conv.id === active.id;
      const li = el('li', `conv-item${isActive ? ' is-active' : ''}`);

      const open = el('button', 'conv-btn');
      open.type = 'button';
      open.dataset.action = 'open';
      open.dataset.id = conv.id;
      if (isActive) open.setAttribute('aria-current', 'true');
      open.append(el('span', 'conv-title', conv.title), el('span', 'conv-meta', formatShort(conv.updatedAt)));

      const remove = el('button', 'conv-delete');
      remove.type = 'button';
      remove.dataset.action = 'delete';
      remove.dataset.id = conv.id;
      remove.setAttribute('aria-label', `Delete conversation: ${conv.title}`);
      remove.appendChild(icon('trash', 'icon'));

      li.append(open, remove);
      dom.convList.appendChild(li);
    });

    dom.clearChat.disabled = !(active && active.messages.length > 0);
  }

  /* ---- header ---- */

  function renderHeader() {
    const conv = getActive();
    dom.convTitle.textContent = conv && conv.messages.length ? conv.title : DEFAULT_TITLE;
  }

  /* ---- message elements ---- */

  function buildCopyButton(getText, label = 'Copy') {
    const button = el('button', 'copy-btn');
    button.type = 'button';
    button.dataset.label = label === 'Copy code' ? 'Copy' : label;
    button.setAttribute('aria-label', label === 'Copy code' ? 'Copy code to clipboard' : 'Copy response to clipboard');
    button.append(icon('copy', 'icon'), el('span', 'btn-label', button.dataset.label));

    button.addEventListener('click', async () => {
      const ok = await copyText(getText());
      if (!ok) {
        showToast('Copy failed. Select the text and copy it manually.');
        return;
      }
      markCopied(button);
      showToast('Copied to clipboard');
    });
    return button;
  }

  function markCopied(button) {
    const useEl = button.querySelector('use');
    const labelEl = button.querySelector('.btn-label');
    button.classList.add('is-copied');
    if (useEl) useEl.setAttribute('href', '#i-check');
    if (labelEl) labelEl.textContent = 'Copied';

    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.classList.remove('is-copied');
      if (useEl) useEl.setAttribute('href', '#i-copy');
      if (labelEl) labelEl.textContent = button.dataset.label;
    }, 1700);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* fall back below */
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function buildAvatar() {
    const avatar = el('div', 'avatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.appendChild(el('span', null, 'J'));
    return avatar;
  }

  function buildUserMessage(msg, animate) {
    const article = el('article', `msg msg-user${animate ? ' is-new' : ''}`);
    article.dataset.id = msg.id;

    const body = el('div', 'msg-body');
    const bubble = el('div', 'bubble', msg.content); // textContent: always safe
    const meta = el('div', 'msg-meta');
    const time = el('time', null, formatClock(msg.time));
    time.dateTime = msg.time;
    meta.appendChild(time);

    body.append(bubble, meta);
    article.appendChild(body);
    return article;
  }

  function buildAssistantMessage(msg, animate) {
    const article = el('article', `msg msg-assistant${animate ? ' is-new' : ''}`);
    article.dataset.id = msg.id;
    if (msg.mode) article.dataset.mode = msg.mode;

    const body = el('div', 'msg-body');
    const bubble = el('div', 'bubble md');
    bubble.appendChild(renderMarkdown(msg.content));

    const meta = el('div', 'msg-meta');
    if (msg.mode) {
      const tag = el('span', 'msg-mode');
      tag.append(el('i', 'mode-dot'), document.createTextNode(modeLabel(msg.mode)));
      meta.appendChild(tag);
    }
    const time = el('time', null, formatClock(msg.time));
    time.dateTime = msg.time;
    meta.append(time, buildCopyButton(() => msg.content));

    body.append(bubble, meta);
    article.append(buildAvatar(), body);
    return article;
  }

  function buildErrorMessage(msg, animate, canRetry) {
    const article = el('article', `msg msg-assistant msg-error${animate ? ' is-new' : ''}`);
    article.dataset.id = msg.id;

    const body = el('div', 'msg-body');
    const card = el('div', 'bubble error-card');
    card.setAttribute('role', 'alert');

    const head = el('div', 'error-head');
    head.append(icon('alert'), el('p', null, msg.content));
    card.appendChild(head);

    if (canRetry) {
      const actions = el('div', 'error-actions');
      const retry = el('button', 'btn btn-outline');
      retry.type = 'button';
      retry.dataset.action = 'retry';
      retry.dataset.id = msg.id;
      retry.append(icon('refresh'), el('span', null, 'Retry'));
      actions.appendChild(retry);
      card.appendChild(actions);
    }

    body.appendChild(card);
    article.append(buildAvatar(), body);
    return article;
  }

  function buildDivider(msg, animate) {
    const row = el('div', `divider${animate ? ' msg is-new' : ''}`);
    row.dataset.id = msg.id;
    row.setAttribute('role', 'note');
    row.appendChild(el('span', null, msg.content));
    return row;
  }

  function buildMessage(conv, msg, animate) {
    if (msg.role === 'system') return buildDivider(msg, animate);
    if (msg.kind === 'error') {
      const isLast = conv.messages[conv.messages.length - 1] === msg;
      return buildErrorMessage(msg, animate, isLast);
    }
    return msg.role === 'user' ? buildUserMessage(msg, animate) : buildAssistantMessage(msg, animate);
  }

  /* ---- thread ---- */

  function scrollToBottom(smooth) {
    const behavior = smooth && !reducedMotionMq.matches ? 'smooth' : 'auto';
    requestAnimationFrame(() => {
      dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior });
    });
  }

  function syncTyping() {
    const active = getActive();
    const show = Boolean(active && state.pending.has(active.id));
    dom.typing.hidden = !show;
    if (show) scrollToBottom(true);
  }

  function renderThread() {
    const conv = getActive();
    dom.thread.setAttribute('aria-busy', 'true');
    dom.thread.replaceChildren();

    const hasMessages = Boolean(conv && conv.messages.length);
    dom.welcome.hidden = hasMessages;

    if (hasMessages) {
      const fragment = document.createDocumentFragment();
      conv.messages.forEach((msg) => fragment.appendChild(buildMessage(conv, msg, false)));
      dom.thread.appendChild(fragment);
    }

    dom.thread.removeAttribute('aria-busy');
    syncTyping();
    scrollToBottom(false);
  }

  /** Add one message to the data and, if visible, to the DOM. */
  function pushMessage(conv, msg) {
    const previousLast = conv.messages[conv.messages.length - 1];
    conv.messages.push(msg);
    touch(conv);

    if (conv.id !== state.activeId) return;

    // The previous error card loses its Retry button once something follows it.
    if (previousLast && previousLast.kind === 'error') {
      const old = dom.thread.querySelector(`[data-id="${CSS.escape(previousLast.id)}"]`);
      if (old) old.replaceWith(buildMessage(conv, previousLast, false));
    }

    dom.welcome.hidden = true;
    dom.thread.appendChild(buildMessage(conv, msg, true));
    scrollToBottom(true);
  }

  function removeMessage(conv, id) {
    conv.messages = conv.messages.filter((m) => m.id !== id);
    if (conv.id === state.activeId) {
      const node = dom.thread.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (node) node.remove();
    }
  }

  function addSystemNote(conv, text) {
    const note = { id: uid(), role: 'system', content: text, time: new Date().toISOString() };
    pushMessage(conv, note);
    return note;
  }

  /* ---- notices above the composer ---- */

  function buildNotice({ tone, title, text, actions }) {
    const box = el('div', `notice notice-${tone}`);
    box.setAttribute('role', 'status');
    box.appendChild(icon(tone === 'warn' ? 'alert' : 'info'));

    const content = el('div', 'notice-text');
    const strong = el('strong', null, title);
    content.append(strong, document.createTextNode(` ${text}`));

    if (actions && actions.length) {
      const row = el('div', 'notice-actions');
      actions.forEach((action) => {
        const button = el('button', `btn ${action.primary ? 'btn-primary' : 'btn-outline'}`, action.label);
        button.type = 'button';
        button.addEventListener('click', action.onClick);
        row.appendChild(button);
      });
      content.appendChild(row);
    }

    box.appendChild(content);
    return box;
  }

  function renderNotices() {
    const conv = getActive();
    dom.notices.replaceChildren();
    if (!conv) return;

    // 1. Backend lost this conversation's memory (restart detected).
    if (conv.expired) {
      dom.notices.appendChild(buildNotice({
        tone: 'warn',
        title: 'The assistant no longer remembers this conversation.',
        text: 'The backend restarted and its in-memory sessions were cleared. Your messages are still saved here, but a new message starts with no earlier context.',
        actions: [
          { label: 'Start new chat', primary: true, onClick: () => newChat() },
          { label: 'Continue here', onClick: () => acknowledgeExpiry(conv) },
        ],
      }));
      return;
    }

    // 2. Selected mode differs from the mode the backend session was built with.
    const hasHistory = conv.sessionId && conv.sessionMode;
    if (hasHistory && conv.sessionMode !== state.mode) {
      dom.notices.appendChild(buildNotice({
        tone: 'info',
        title: `Switching to ${modeLabel(state.mode)} mode resets the assistant's memory.`,
        text: 'Earlier messages stay visible here, but the backend starts a fresh history for the new mode, so the assistant will not see them.',
        actions: [
          { label: `Keep ${modeLabel(conv.sessionMode)}`, onClick: () => setMode(conv.sessionMode) },
        ],
      }));
    }
  }

  /* ---- composer ---- */

  function composerLength() {
    return dom.input.value.trim().length;
  }

  function autosizeInput() {
    dom.input.style.height = 'auto';
    const next = Math.min(dom.input.scrollHeight, TEXTAREA_MAX_HEIGHT);
    dom.input.style.height = `${next}px`;
    dom.input.style.overflowY = dom.input.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }

  function renderComposer() {
    const length = composerLength();
    const conv = getActive();
    const busy = Boolean(conv && state.pending.has(conv.id));
    const over = length > MAX_CHARS;

    dom.counter.classList.toggle('is-near', length >= NEAR_LIMIT_CHARS && !over);
    dom.counter.classList.toggle('is-over', over);
    dom.counter.textContent = over
      ? `${(length - MAX_CHARS).toLocaleString()} over the ${MAX_CHARS.toLocaleString()} limit`
      : `${length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;

    dom.send.disabled = busy || length === 0 || over;
    dom.send.classList.toggle('is-loading', busy);
    dom.send.setAttribute('aria-label', busy ? 'Waiting for reply' : 'Send message');
    dom.send.setAttribute('aria-busy', busy ? 'true' : 'false');

    dom.welcome.querySelectorAll('.prompt-card').forEach((card) => { card.disabled = busy; });
  }

  function renderAll() {
    renderMode();
    renderStatus();
    renderSidebar();
    renderHeader();
    renderThread();
    renderNotices();
    renderComposer();
  }

  /* ======================================================================
     7. Conversation actions
     ====================================================================== */

  function setMode(mode) {
    if (!modes.includes(mode)) return;
    state.mode = mode;
    saveState();
    renderMode();
    renderNotices();
  }

  function switchTo(id) {
    if (id === state.activeId) { closeDrawer(); return; }
    if (!state.conversations.some((c) => c.id === id)) return;
    state.activeId = id;
    pruneEmpty();
    saveState();
    renderAll();
    closeDrawer();
    dom.input.focus({ preventScroll: true });
  }

  function newChat() {
    const current = getActive();
    // Reuse an untouched empty conversation instead of piling up blanks.
    if (!current || current.messages.length > 0) {
      const conv = createConversation();
      state.activeId = conv.id;
      pruneEmpty();
      pruneOld();
    }
    saveState();
    renderAll();
    closeDrawer();
    dom.input.focus({ preventScroll: true });
  }

  async function clearConversation() {
    const conv = getActive();
    if (!conv || conv.messages.length === 0) return;

    const ok = await confirmAction({
      title: 'Clear this conversation?',
      body: 'All messages in this conversation will be removed from this browser, and the assistant starts again with no memory of them.',
      confirmLabel: 'Clear conversation',
    });
    if (!ok) return;

    conv.gen += 1;                 // late replies for the old content are dropped
    conv.messages = [];
    conv.title = DEFAULT_TITLE;
    conv.sessionId = null;         // fresh backend session on the next message
    conv.sessionMode = null;
    conv.bootId = null;
    conv.expired = false;
    state.pending.delete(conv.id);
    touch(conv);
    saveState();
    renderAll();
    showToast('Conversation cleared');
    dom.input.focus({ preventScroll: true });
  }

  async function deleteConversation(id) {
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) return;

    const ok = await confirmAction({
      title: 'Delete this conversation?',
      body: `"${conv.title}" will be removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    state.conversations = state.conversations.filter((c) => c.id !== id);
    state.pending.delete(id);
    if (state.activeId === id) {
      state.activeId = null;
      ensureActive();
    }
    saveState();
    renderAll();
  }

  /** The backend lost this session: reset the link and say so in the thread. */
  function acknowledgeExpiry(conv) {
    conv.expired = false;
    conv.sessionId = null;
    conv.sessionMode = null;
    conv.bootId = null;
    addSystemNote(conv, 'The backend restarted. The assistant continues without memory of the messages above.');
    saveState();
    if (conv.id === state.activeId) renderNotices();
  }

  /* ======================================================================
     8. Sending messages
     ====================================================================== */

  /**
   * Send one message through the real /chat endpoint.
   * `retry` re-sends the last user message without duplicating it.
   */
  async function submitMessage(rawText, { retry = false } = {}) {
    const conv = ensureActive();
    if (state.pending.has(conv.id)) return;

    const text = String(rawText).trim();
    if (!text) return;
    if (text.length > MAX_CHARS) {
      showToast(`Messages are limited to ${MAX_CHARS.toLocaleString()} characters.`);
      return;
    }

    const mode = state.mode;
    const generation = conv.gen;

    state.pending.add(conv.id);
    renderComposer();
    syncTyping();

    let modeNote = null;

    try {
      // Refresh health first so a backend restart is noticed before we send.
      await checkHealth({ quiet: true });
      if (conv.gen !== generation || !state.conversations.includes(conv)) return;

      if (conv.sessionId && conv.bootId && state.health.bootId && conv.bootId !== state.health.bootId) {
        conv.expired = true;
      }
      if (conv.expired) {
        acknowledgeExpiry(conv);
      } else if (conv.sessionId && conv.sessionMode && conv.sessionMode !== mode) {
        modeNote = addSystemNote(
          conv,
          `Mode changed to ${modeLabel(mode)}. The assistant starts fresh and cannot see the messages above.`
        );
      }

      if (!retry) {
        const isFirst = conv.messages.filter((m) => m.role === 'user').length === 0;
        pushMessage(conv, { id: uid(), role: 'user', content: text, time: new Date().toISOString() });
        if (isFirst) conv.title = makeTitle(text);
        renderHeader();
      }
      saveState();
      renderSidebar();
      renderNotices();

      // ---- the real backend call ----
      const data = await postChat({ message: text, mode, session_id: conv.sessionId });

      if (conv.gen !== generation || !state.conversations.includes(conv)) return;

      conv.sessionId = data.session_id;                       // reuse on the next message
      conv.sessionMode = modes.includes(data.mode) ? data.mode : mode;
      conv.bootId = state.health.bootId;

      if (!data.reply.trim()) {
        throw new ChatError(
          'empty',
          'The model returned an empty reply. This usually means its token limit was used up. Select Retry, or raise max_tokens in backend.py.'
        );
      }

      pushMessage(conv, {
        id: uid(),
        role: 'assistant',
        content: data.reply,
        mode: conv.sessionMode,
        time: new Date().toISOString(),
      });
    } catch (error) {
      if (conv.gen !== generation || !state.conversations.includes(conv)) return;

      const chatError = error instanceof ChatError
        ? error
        : new ChatError('network', networkMessage());

      // The backend never saw the request: undo the "mode changed" note.
      if (modeNote && ['network', 'timeout'].includes(chatError.kind)) {
        removeMessage(conv, modeNote.id);
      } else if (chatError.kind === 'http' && chatError.status !== 422 && conv.sessionId) {
        conv.sessionMode = mode; // backend already rebuilt the session for this mode
      }

      if (chatError.kind === 'network') setHealth('disconnected');

      pushMessage(conv, {
        id: uid(),
        role: 'assistant',
        kind: 'error',
        content: chatError.message,
        time: new Date().toISOString(),
      });
    } finally {
      state.pending.delete(conv.id);
      saveState();
      renderSidebar();
      renderNotices();
      renderComposer();
      syncTyping();
      if (conv.id === state.activeId && !mobileMq.matches) dom.input.focus({ preventScroll: true });
    }
  }

  /** Retry the user message that preceded the latest error. */
  function retryLast(errorId) {
    const conv = getActive();
    if (!conv || state.pending.has(conv.id)) return;

    const index = conv.messages.findIndex((m) => m.id === errorId);
    if (index === -1) return;

    let lastUser = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (conv.messages[i].role === 'user') { lastUser = conv.messages[i]; break; }
    }
    if (!lastUser) return;

    removeMessage(conv, errorId);
    saveState();
    submitMessage(lastUser.content, { retry: true });
  }

  /* ======================================================================
     9. Layout, dialogs, toasts
     ====================================================================== */

  function applyLayout() {
    const mobile = mobileMq.matches;
    if (!mobile) state.drawerOpen = false;

    dom.app.classList.toggle('is-collapsed', !mobile && state.sidebarCollapsed);
    dom.app.classList.toggle('drawer-open', mobile && state.drawerOpen);

    const hidden = mobile ? !state.drawerOpen : state.sidebarCollapsed;
    dom.sidebar.inert = hidden; // hidden content is unreachable by keyboard and screen readers

    const label = mobile ? (hidden ? 'Open menu' : 'Close menu') : (hidden ? 'Show sidebar' : 'Hide sidebar');
    dom.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
    dom.sidebarToggle.setAttribute('aria-label', label);
    dom.sidebarToggle.dataset.tip = label;
  }

  function toggleSidebar() {
    if (mobileMq.matches) {
      state.drawerOpen = !state.drawerOpen;
      applyLayout();
      if (state.drawerOpen) {
        // Wait for the drawer to become visible before moving focus into it.
        setTimeout(() => dom.newChatSide.focus({ preventScroll: true }), 60);
      }
    } else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      saveState();
      applyLayout();
    }
  }

  function closeDrawer() {
    if (!mobileMq.matches || !state.drawerOpen) return;
    state.drawerOpen = false;
    applyLayout();
  }

  /** Promise-based confirmation using the native <dialog>. */
  function confirmAction({ title, body, confirmLabel }) {
    return new Promise((resolve) => {
      dom.dialogTitle.textContent = title;
      dom.dialogBody.textContent = body;
      dom.dialogOk.textContent = confirmLabel;
      dom.dialog.returnValue = '';
      dom.dialog.addEventListener('close', () => resolve(dom.dialog.returnValue === 'confirm'), { once: true });
      dom.dialog.showModal();
    });
  }

  let toastTimer = null;
  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2200);
  }

  /* ======================================================================
     10. Event wiring and start-up
     ====================================================================== */

  function handleComposerSubmit(event) {
    event.preventDefault();
    const conv = getActive();
    if (!conv || state.pending.has(conv.id)) return;

    const text = dom.input.value.trim();
    if (!text || text.length > MAX_CHARS) return;

    dom.input.value = '';
    autosizeInput();
    renderComposer();
    submitMessage(text);
  }

  function bindEvents() {
    // Composer
    dom.form.addEventListener('submit', handleComposerSubmit);
    dom.input.addEventListener('input', () => { autosizeInput(); renderComposer(); });
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();               // Enter sends, Shift+Enter inserts a newline
        if (!dom.send.disabled) dom.form.requestSubmit();
      }
    });

    // Mode selector
    dom.modeInputs.forEach((input) => {
      input.addEventListener('change', () => { if (input.checked) setMode(input.value); });
    });

    // Example prompts go through the normal chat flow
    dom.welcome.addEventListener('click', (event) => {
      const card = event.target.closest('.prompt-card');
      if (card && !card.disabled) submitMessage(card.dataset.prompt);
    });

    // Retry on error cards
    dom.thread.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="retry"]');
      if (button) retryLast(button.dataset.id);
    });

    // Sidebar actions
    dom.newChatSide.addEventListener('click', newChat);
    dom.newChatTop.addEventListener('click', newChat);
    dom.clearChat.addEventListener('click', clearConversation);
    dom.convList.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'open') switchTo(target.dataset.id);
      if (target.dataset.action === 'delete') deleteConversation(target.dataset.id);
    });

    // Sidebar visibility
    dom.sidebarToggle.addEventListener('click', toggleSidebar);
    dom.drawerClose.addEventListener('click', () => { closeDrawer(); dom.sidebarToggle.focus(); });
    dom.scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.drawerOpen && !dom.dialog.open) {
        closeDrawer();
        dom.sidebarToggle.focus();
      }
    });
    mobileMq.addEventListener('change', applyLayout);

    // Backend status
    dom.statusBtn.addEventListener('click', () => checkHealth());
    window.addEventListener('online', () => checkHealth());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkHealth({ quiet: true }); });

    // Confirmation dialog: clicking the backdrop cancels
    dom.dialog.addEventListener('click', (event) => { if (event.target === dom.dialog) dom.dialog.close('cancel'); });
  }

  function init() {
    loadState();
    ensureActive();
    pruneEmpty();
    saveState();

    bindEvents();
    applyLayout();
    renderAll();
    autosizeInput();

    checkHealth();
    setInterval(() => checkHealth({ quiet: true }), HEALTH_INTERVAL_MS);

    if (!mobileMq.matches) dom.input.focus({ preventScroll: true });
  }

  init();
})();
