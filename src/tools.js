// Browser tools shared by every AI that drives Skillerr: external agents over MCP
// and the built-in agent. One definition list, one implementation.

const guard = require('./guard');
const uploads = require('./uploads');
const { searchApi, resultsPage, PROVIDERS } = require('./search-api');

const TAB_ID = {
  type: 'integer',
  description: 'Act on this tab instead of the active one. Calls on different tabs can run in parallel.',
};

// Tools that act on a page accept an optional tab_id (fleet mode).
const PAGE_TOOLS = [
  {
    name: 'snapshot',
    description:
      'Describe the page: URL, title, scroll position and a numbered list of interactive elements (links, buttons, inputs…), ' +
      'including those inside iframes and shadow DOM. Use the [id] numbers with click/type/select_option. Ids go stale after navigation.',
    input_schema: { type: 'object', properties: { full_page: { type: 'boolean', description: 'Include elements outside the viewport (default false).' } } },
  },
  {
    name: 'navigate',
    description: 'Open a URL in the tab. Plain words are sent to a web search.',
    input_schema: { type: 'object', properties: { url: { type: 'string', description: 'URL or search query' } }, required: ['url'] },
  },
  {
    name: 'click',
    description: 'Click an element by its [id] from the latest snapshot. Returns a fresh snapshot.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'type',
    description: 'Type text into an input/textarea/editable element by [id], replacing its content. submit=true presses Enter after.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean', description: 'Press Enter after typing' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'select_option',
    description: 'Choose an option in a <select> by [id], matching the option value or visible label.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' }, option: { type: 'string' } }, required: ['id', 'option'] },
  },
  {
    name: 'upload_file',
    description: 'Attach files from the user\'s computer to the page: a file input, or a button that opens a file picker (e.g. "Add photos or video"). ' +
      'Give the element\'s [id] from the snapshot, or a CSS selector such as "input[type=file]" when the input itself is hidden, and the full paths of ' +
      'the files. The user must approve every upload in Skillerr (they see the file names and the site); if they decline, do not retry. ' +
      'Files in credential folders (~/.ssh, ~/.skillerr, keychains, password managers, browser profiles) and key files are always refused.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'The file input, or the button that opens the file picker.' },
        selector: { type: 'string', description: 'CSS selector for the file input, used instead of id (searched in the page and its open shadow roots).' },
        paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10, description: 'Full paths of the files, e.g. "~/Pictures/card-tabs.png".' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a key on the focused element, e.g. Enter, Escape, Tab, ArrowDown, Backspace.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'scroll',
    description: 'Scroll up or down by about one screen (or `amount` pixels). Returns a fresh snapshot.',
    input_schema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', description: 'Pixels (optional)' } },
      required: ['direction'],
    },
  },
  {
    name: 'read_page',
    description: 'Return the readable text of the page (articles, results, prices…).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'screenshot',
    description: 'Screenshot of the visible page, for when layout or visuals matter. Only works on the visible tab.',
    input_schema: { type: 'object', properties: {} },
  },
  { name: 'go_back', description: 'Go back in history.', input_schema: { type: 'object', properties: {} } },
  { name: 'go_forward', description: 'Go forward in history.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'wait',
    description: 'Wait for loading or dynamic content (max 10000 ms).',
    input_schema: { type: 'object', properties: { ms: { type: 'integer' } } },
  },
];
for (const t of PAGE_TOOLS) t.input_schema.properties.tab_id = TAB_ID;

const TAB_TOOLS = [
  { name: 'list_tabs', description: 'List open tabs with their ids.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'new_tab',
    description: 'Open a new tab (optionally at a URL) and switch to it.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } } },
  },
  {
    name: 'switch_tab',
    description: 'Bring a tab to the front by id.',
    input_schema: { type: 'object', properties: { tab_id: { type: 'integer' } }, required: ['tab_id'] },
  },
  {
    name: 'close_tab',
    description: 'Close a tab by id (defaults to the active tab).',
    input_schema: { type: 'object', properties: { tab_id: { type: 'integer' } } },
  },
];

// Fleet mode: work across many tabs at once.
const FLEET_TOOLS = [
  {
    name: 'open_tabs',
    description:
      'Open several URLs at once in background tabs and wait for them to load. Returns their tab ids. ' +
      'Then act on each with the tab_id parameter (calls on different tabs run in parallel) and collect results with read_tabs.',
    input_schema: {
      type: 'object',
      properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'URLs or search queries' } },
      required: ['urls'],
    },
  },
  {
    name: 'read_tabs',
    description: 'Read the text of several tabs in one call (default: the user\'s tabs and the ones you opened; never another AI app\'s). Use to compare or aggregate across tabs.',
    input_schema: { type: 'object', properties: { tab_ids: { type: 'array', items: { type: 'integer' } } } },
  },
  {
    name: 'dispatch',
    description:
      'Run the same instruction in several tabs concurrently, each handled by its own Skillerr worker, and get every tab\'s answer back. ' +
      'Give tab_ids of open tabs and/or urls to open. Requires Skillerr\'s built-in AI to be set up; otherwise use open_tabs + tab_id + read_tabs.',
    input_schema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'What each worker should do in its tab, and what to report back.' },
        tab_ids: { type: 'array', items: { type: 'integer' } },
        urls: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
      required: ['instruction'],
    },
  },
];

// Skills: packaged playbooks (demo videos, guides, audits…) any AI can load and follow.
const SKILL_TOOLS = [
  {
    name: 'list_skills',
    description: 'List the skills installed in Skillerr: step-by-step playbooks for jobs like recording a product demo or writing a how-to guide. ' +
      'Check this when a task sounds like a repeatable workflow.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'use_skill',
    description: 'Load a skill\'s instructions by name, then follow them.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

// Recording: turn what you do in a tab into a demo video plus a step-by-step guide.
const RECORD_TOOLS = [
  {
    name: 'record_start',
    description: 'Start recording a tab (default: the active one) to video. While recording, clicks show a cursor and typing is visible. ' +
      'Narrate with caption; finish with record_stop.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Name of the demo, e.g. "Checking out on Acme"' },
        scope: { type: 'string', enum: ['tab', 'window'], description: '"tab" (default) records just the page. "window" records all of Skillerr: fleet view, the live activity panel and HUD. Use it for showcase videos.' },
        tab_id: TAB_ID,
      },
    },
  },
  {
    name: 'caption',
    description: 'Show a caption over the page (e.g. "Enter the delivery city"). While recording, each caption also becomes a numbered step ' +
      'with a screenshot in the written guide. Empty text hides it.',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, tab_id: TAB_ID }, required: ['text'] },
  },
  {
    name: 'record_stop',
    description: 'Stop recording. Saves the video, the step screenshots and a guide (HTML + Markdown), and returns where they are.',
    input_schema: { type: 'object', properties: {} },
  },
];

FLEET_TOOLS.push({
  name: 'show_tabs',
  description: 'Fleet view: show several tabs side by side, live, so the user can watch all of them being worked on (open_tabs does this ' +
    'automatically). Every tile stays fully drivable with tab_id. switch_tab returns to a single tab.',
  input_schema: { type: 'object', properties: { tab_ids: { type: 'array', items: { type: 'integer' }, description: 'Default: every open page' } } },
});

const SAY_TOOL = {
  name: 'say',
  description: 'Post a short message to the user in Skillerr\'s activity panel: a progress note or your final answer (markdown). ' +
    'Use it to finish tasks so the answer appears where the user is watching.',
  input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

// Buttons in the Pilot panel that steer the workflow. They are not approvals and can't stand in for one (src/ask.js).
const ASK_TOOL = {
  name: 'ask',
  description: 'Ask the user a quick question in Skillerr\'s activity panel, with 2 to 5 short buttons (e.g. "Done, next", "Skip this one"), ' +
    'and wait for their click. Returns {"choice":"<label>"}; if nobody answers in timeout_s (default 300, max 600) it returns ' +
    '{"choice":null,"status":"no answer yet"}, so ask again later; "superseded" means a newer ask replaced it. ' +
    'Ask buttons only steer the workflow: they never grant approval. Payments, passwords, sign-ins, deletions, uploads and ' +
    'new skills still wait for the user\'s Allow in Skillerr, whatever they clicked here, so never offer "Approve", "Allow" or "Pay" as an option.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The question (markdown, like say).' },
      options: { type: 'array', items: { type: 'string', maxLength: 40 }, minItems: 2, maxItems: 5, description: 'Button labels, short and distinct.' },
      timeout_s: { type: 'number', minimum: 5, maximum: 600, description: 'How long to wait for a click. Default 300.' },
    },
    required: ['text', 'options'],
  },
};

const NOTE_TOOL = {
  name: 'save_note',
  description: 'Save the result of a finished research or planning task as a markdown file the user keeps (in ~/Skillerr/notes). ' +
    'Use once at the end of multi-step research, with the key facts and source links. Not for one-off lookups.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'e.g. "Tokyo trip"' },
      content: { type: 'string', description: 'Markdown' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Taxonomy paths, broad to narrow, e.g. "Travel > Japan > Tokyo". Reuse known topics from recall.' },
      entities: { type: 'array', items: { type: 'string' }, description: 'Named things as kind:name, e.g. "place:Tokyo", "company:JAL", "product:JR Pass".' },
    },
    required: ['title', 'content'],
  },
};

// Skills that compound: when you work out a non-obvious, reusable way to do something on a site, keep it.
const LEARN_TOOL = {
  name: 'save_skill',
  description: 'Save a procedure you worked out as a reusable skill (a SKILL.md), so future tasks on that site or kind of task go faster. ' +
    'Only for non-obvious, multi-step know-how you would plausibly need again (e.g. a site\'s cookie wall must be closed before its search ' +
    'box works; its date picker needs two clicks). Not for answers (use save_note) and not for trivial steps. Call list_skills first: ' +
    'if a skill for the same site or task exists, pass its name to refine it instead of creating a duplicate. The user approves each save; ' +
    'if they don\'t answer in time (or pick Later), it is kept as a suggested skill they can save later, not active until they do. ' +
    'Skills never contain the user\'s personal details (names, handles, emails, phone numbers, account or order numbers, home-folder ' +
    'paths, passwords, keys): write placeholders such as x.com/<handle> or <email>; a skill containing them is refused.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'lowercase-with-hyphens, e.g. "ana-flight-search"' },
      description: { type: 'string', description: 'One sentence saying WHEN to use it: the site and task it applies to. This is how it gets picked later.' },
      instructions: { type: 'string', description: 'Markdown: the steps that worked, gotchas, selectors or URL patterns, and what to check. Never include passwords, personal data or one-off values (use placeholders like <handle>).' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Taxonomy paths, e.g. "Travel > Flights". Reuse known topics from recall.' },
    },
    required: ['name', 'description', 'instructions'],
  },
};

// Research memory: what was researched before, connected by topic, entity and overlap.
const MEMORY_TOOLS = [
  {
    name: 'recall',
    description: 'Look up related past research before starting a research task: earlier sessions, notes, skills and pages, each with how it connects ' +
      '(e.g. "via topic Travel > Japan"). Call it first with the task in your own words; build on what it finds instead of redoing it.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'tag_session',
    description: 'File the research session you just finished: a one-line summary plus topics and entities, so it can be recalled and connected later. ' +
      'Call once at the end of a research task (after save_note, if you saved one).',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One sentence: what was found or decided.' },
        topics: { type: 'array', items: { type: 'string' }, description: 'Taxonomy paths, broad to narrow, e.g. "Travel > Japan > Tokyo". Reuse known topics from recall.' },
        entities: { type: 'array', items: { type: 'string' }, description: 'Named things as kind:name, e.g. "place:Tokyo", "company:JAL", "product:JR Pass".' },
      },
      required: ['summary'],
    },
  },
];

const DEEP_TOOL = {
  name: 'deep_research',
  description: 'Deep research: read starting pages, follow the links on them most relevant to the question, read those, and keep going ' +
    'up to `depth` link-hops away (default from the user\'s setting, usually 3), in visible tabs. Returns the relevant passages from every ' +
    'page read, with URLs, so you can answer with sources. Start from `urls`, or from the open tabs if none are given.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question being researched; used to pick which links to follow and which passages to keep.' },
      urls: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Starting pages (URLs or search queries).' },
      depth: { type: 'integer', minimum: 1, maximum: 5 },
      max_pages: { type: 'integer', minimum: 3, maximum: 60, description: 'Stop after this many pages (default 30).' },
    },
    required: ['query'],
  },
};

// Continuity: where the user's research lives, so any AI can pick up earlier work.
const LIBRARY_TOOLS = [
  {
    name: 'my_research',
    description: 'Where the user\'s Skillerr research lives and what\'s in it: the notes folder with recent notes, learned and installed skills, ' +
      'and research memory. Use it when the user refers to earlier research, or to tell them where something was saved.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_note',
    description: 'Read a saved research note (Markdown) by its title or file name, to continue or build on earlier work.',
    input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
];

// Trails: the user's own ongoing work, learned from how they browse (src/trails.js). An AI app sees them only after the
// user allows it once, in Skillerr.
const TRAIL_TOOLS = [
  {
    name: 'my_trails',
    description: 'The user\'s trails: threads of their own ongoing work in Skillerr (e.g. "Kyoto trip", "Standing desk"), learned from what ' +
      'they browse. Each says where they stopped, what they left unfinished (a form not sent, an article read partway, a cart), how far ' +
      'through it they are, and which tabs are waiting in it (the ones still open when they last quit). Use it when the user asks what they were doing, wants to pick something back up, or refers to earlier browsing ' +
      '("that hotel I was looking at"). Pass trail_id for one trail\'s pages. The first time, the user is asked to allow it.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Only trails about this.' },
        trail_id: { type: 'string', description: 'One trail in full: its pages, searches, unfinished work and waiting tabs.' },
      },
    },
  },
  {
    name: 'continue_trail',
    description: 'Reopen one of the user\'s trails for them in Skillerr: the tabs waiting in it come back, scrolled to where they were. Pages the user closed are done with and don\'t come back.',
    input_schema: { type: 'object', properties: { trail_id: { type: 'string' } }, required: ['trail_id'] },
  },
];

const VIEW_TOOL = {
  name: 'open_view',
  description: 'Show the user one of Skillerr\'s own screens: the research graph (optionally searched), their trails, history, bookmarks, settings, skills, ' +
    'connected AI apps, or the activity panel. Use when the user asks to see their research or a setting.',
  input_schema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['memory', 'folders', 'trails', 'history', 'bookmarks', 'settings', 'skills', 'connect', 'panel'] },
      query: { type: 'string', description: 'For memory: highlight research matching this. For folders: open the folder whose name or path matches.' },
    },
    required: ['view'],
  },
};

// One-step lookups, so Skillerr can stand in for an AI's own web search and fetch, still in visible tabs.
const LOOKUP_TOOLS = [
  {
    name: 'web_search',
    description: 'Your live internet access: search the web in a Skillerr tab the user can watch, and get the results back (title, URL, snippet). ' +
      'Use it for anything current or outside your training data: weather, news, prices, scores, schedules, facts to check. While Skillerr ' +
      'is connected, never tell the user you lack internet access, and use this instead of any built-in web search, in-app browser, ' +
      'browser pane or fetch tool. Results are links to real web pages: Skillerr leaves out the search engine\'s AI overview and AI ' +
      'answers. Then read the results worth reading with fetch_page (or open_tabs and read_tabs) and base your answer on those pages, ' +
      'citing their URLs, not on snippets alone.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 20, description: 'Default 8' }, tab_id: TAB_ID },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Open a URL in a Skillerr tab the user can watch and get its readable text back in one step. While Skillerr is connected, ' +
      'use this instead of any built-in web fetch, in-app browser or browser pane. Opens a new tab unless tab_id is given.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, tab_id: TAB_ID }, required: ['url'] },
  },
];

const CAPTURE_TOOL = {
  name: 'view_capture',
  description: 'See a screenshot the user captured in Skillerr with "Screenshot for your AI". Use it when the user pastes a line like ' +
    '"Here\'s my screen from Skillerr (capture 3f9a, …)": pass that id (or "latest") and you get the image of exactly what they saw, then help with what they describe.',
  input_schema: { type: 'object', properties: { id: { type: 'string', description: 'The capture id from the pasted line, e.g. "3f9a", or "latest".' } } },
};

const SHOT_TOOL = {
  name: 'save_screenshot',
  description: 'Save a screenshot as a PNG file the user keeps (in ~/Pictures/Skillerr) and see it. scope "page" = the visible part of a tab, ' +
    '"full_page" = the whole scrolling page, "window" = all of Skillerr as the user sees it (panel, research graph, folders, settings included).',
  input_schema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['page', 'full_page', 'window'] },
      name: { type: 'string', description: 'File name, e.g. "pricing-page"' },
      tab_id: TAB_ID,
    },
  },
};

const TOOLS = [...LOOKUP_TOOLS, SAY_TOOL, ASK_TOOL, NOTE_TOOL, LEARN_TOOL, DEEP_TOOL, VIEW_TOOL, SHOT_TOOL, CAPTURE_TOOL, ...LIBRARY_TOOLS, ...MEMORY_TOOLS, ...TRAIL_TOOLS, ...PAGE_TOOLS, ...TAB_TOOLS, ...FLEET_TOOLS, ...SKILL_TOOLS, ...RECORD_TOOLS];

// ---------- page-side scripts ----------

// Helpers injected into every page script: search through open shadow roots too.
const DEEP = `
  const deepAll = (root, sel, out = []) => {
    out.push(...root.querySelectorAll(sel));
    for (const h of root.querySelectorAll('*')) if (h.shadowRoot) deepAll(h.shadowRoot, sel, out);
    return out;
  };
  const deepFind = (sel) => deepAll(document, sel)[0] || null;
`;

const SNAPSHOT_JS = (fullPage, startId) => `(() => {
  ${DEEP}
  ${guard.HIDE_JS}
  const __h = __skHide();
  try {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
  deepAll(document, '[data-skillerr-id]').forEach(e => e.removeAttribute('data-skillerr-id'));
  const vw = innerWidth, vh = innerHeight;
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
  const items = [];
  let n = ${startId} - 1;
  for (const el of deepAll(document, SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    if (!${fullPage} && !inView) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'input:' + (el.type || 'text') : tag);
    const labelled = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const svgTitle = el.querySelector('svg title');
    const href = tag === 'a' ? (el.getAttribute('href') || '').replace(/^https?:\\/\\/(www\\.)?/, '').slice(0, 60) : '';
    const name = clean(el.getAttribute('aria-label') || labelled || el.innerText || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || (el.querySelector('img') || {}).alt ||
      (svgTitle && svgTitle.textContent) || el.name || el.value || (href && '→ ' + href));
    const id = ++n;
    el.setAttribute('data-skillerr-id', id);
    const it = { id, role, name, inView };
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'checkbox' || el.type === 'radio') it.checked = el.checked;
      else if (el.value && el.type !== 'password') it.value = clean(el.value);
      if (el.placeholder && name !== clean(el.placeholder)) it.placeholder = clean(el.placeholder);
    } else if (tag === 'select') {
      it.selected = clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text);
    }
    if (el.disabled) it.disabled = true;
    items.push(it);
    if (items.length >= 300) break;
  }
  const doc = document.documentElement;
  return {
    url: location.href,
    title: document.title,
    scroll: Math.round(100 * scrollY / Math.max(1, doc.scrollHeight - vh)),
    scrollable: doc.scrollHeight > vh + 10,
    items,
    hidden: __h.hidden.join('\\n'),
    next: n + 1,
  };
  } finally { __h.restore(); }
})()`;

const LOCATE_JS = (id) => `(() => {
  ${DEEP}
  const el = deepFind('[data-skillerr-id="${id}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// Offset of the n-th child frame's content box, optionally scrolling it into view first.
const FRAME_RECT_JS = (index, scroll) => `(() => {
  const f = document.querySelectorAll('iframe,frame')[${index}];
  if (!f) return null;
  ${scroll ? "f.scrollIntoView({ block: 'center', behavior: 'instant' });" : ''}
  const r = f.getBoundingClientRect(), cs = getComputedStyle(f);
  return { x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
           y: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
           w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
})()`;

// Inspect an element before acting: its label, whether it's sensitive, and its value (for undo).
const INSPECT_JS = (id, undoKey) => `(() => {
  ${DEEP}
  const el = ${id == null ? 'document.activeElement' : `deepFind('[data-skillerr-id="${id}"]')`};
  if (!el || el === document.body || el === document.documentElement) return null;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const label = (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText ||
    el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const hints = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder, el.getAttribute('data-elements-stable-field-name')]
    .join(' ').toLowerCase();
  const form = el.form || el.closest('form');
  const formHasPassword = !!(form && form.querySelector('input[type=password]'));
  let sensitive = null;
  if (type === 'password') sensitive = 'a password field';
  else if (/cc-|card.?number|cardnumber|cvv|cvc|csc|expir|iban|routing|account.?num|ssn|social.?security|tax.?id/.test(hints))
    sensitive = 'payment or identity details';
  else if (/\\b(pay|pay now|purchase|buy|buy now|place (your )?order|submit order|complete (order|purchase)|checkout|check out|confirm|delete|transfer|send money|donate|subscribe)\\b/i.test(label))
    sensitive = 'an action that may spend money, confirm, or delete something';
  else if ((type === 'submit' || tag === 'button') && formHasPassword) sensitive = 'submitting a sign-in form';
  let value = null;
  if (type !== 'password') {
    if (tag === 'input' || tag === 'textarea' || tag === 'select') value = el.value;
    else if (el.isContentEditable) value = el.innerText;
  }
  ${undoKey ? `el.setAttribute('data-skillerr-undo', '${undoKey}');` : ''}
  return { label, tag, type, sensitive, value, formHasPassword };
})()`;

// Set a form control's value the way a user would, so frameworks notice.
const SET_VALUE_JS = (selector, value) => `(() => {
  ${DEEP}
  const el = deepFind(${JSON.stringify(selector)});
  if (!el) return false;
  const v = ${JSON.stringify(value)};
  el.focus();
  if (el.isContentEditable) el.innerText = v;
  else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

// Animated "ghost cursor" so the user can see what the AI is doing.
const CURSOR_JS = (x, y) => `(() => {
  let c = document.getElementById('__skillerr_cursor');
  if (!c) {
    c = document.createElement('div');
    c.id = '__skillerr_cursor';
    c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;' +
      'background:radial-gradient(circle,rgba(139,108,255,.45),rgba(61,224,192,.15) 70%);border:2px solid rgba(139,108,255,.9);' +
      'box-shadow:0 0 18px rgba(139,108,255,.7);transition:left .28s cubic-bezier(.2,.8,.2,1),top .28s cubic-bezier(.2,.8,.2,1),transform .15s;left:50vw;top:50vh';
    document.documentElement.appendChild(c);
  }
  c.style.left = ${x} + 'px'; c.style.top = ${y} + 'px';
  setTimeout(() => { c.style.transform = 'scale(.55)'; setTimeout(() => c.style.transform = 'scale(1)', 160); }, 300);
})()`;

// Result links from a search page (Google, DuckDuckGo or Bing), with a generic fallback.
// Google hides result URLs behind /goto redirects. Ask where each one points without loading the page.
function resolveRedirect(wc, url) {
  if (!/^https:\/\/(www\.)?google\.[a-z.]+\/goto\?/.test(url)) return Promise.resolve(url);
  const { net } = require('electron');
  return new Promise((done) => {
    const timer = setTimeout(() => done(url), 3000);
    const finish = (u) => { clearTimeout(timer); done(u); };
    try {
      const req = net.request({ url, session: wc.session, redirect: 'manual', useSessionCookies: true });
      req.on('redirect', (_code, _method, to) => { finish(to); req.abort(); });
      req.on('response', () => finish(url));
      req.on('error', () => finish(url));
      req.end();
    } catch {
      finish(url);
    }
  });
}

const RESULTS_JS = (max) => `(() => {
  ${guard.HIDE_JS}
  const __h = __skHide();
  try {
  const out = [];
  const seen = new Set();
  // AI answers on the results page (Google's AI Overview and AI Mode, Bing's Copilot answer, DuckDuckGo's Search Assist
  // and Assist): the block under such a label, grown as far as it goes without taking in a real result (a linked heading).
  const AI_LABEL = /^(AI Overview|AI overview|AI Mode|Search Assist|Assist|Copilot( Answer| Search)?|Deep Search|Generated by AI|AI-generated answer)$/;
  const aiBlocks = [];
  for (const el of document.querySelectorAll('h1, h2, h3, h4, [role=heading], span, div, strong')) {
    if (el.children.length > 2 || !AI_LABEL.test((el.textContent || '').trim())) continue;
    let block = el;
    while (block.parentElement && block.parentElement !== document.body && !block.parentElement.querySelector('a h3, a h2, a[data-testid=result-title-a]')) block = block.parentElement;
    if (!aiBlocks.some((b) => b.contains(block))) aiBlocks.push(block);
  }
  const inAi = (a) => aiBlocks.some((b) => b.contains(a));
  const push = (a, title, snippet) => {
    let href = a && a.href;
    if (!href || !/^https?:/.test(href) || inAi(a)) return;
    try {
      const u = new URL(href);
      if (/(^|\\.)google\\./.test(u.hostname) && u.pathname === '/url') href = u.searchParams.get('q') || href;
      if (/(^|\\.)google\\./.test(u.hostname) && u.pathname === '/goto') { if (!seen.has(href) && title) { seen.add(href); out.push({ title: title.trim().slice(0, 160), url: href, snippet: (snippet || '').replace(/\\s+/g, ' ').trim().slice(0, 300) }); } return; }
      if (/duckduckgo\\.com$/.test(u.hostname) && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
      if (/(google|duckduckgo|bing)\\./.test(new URL(href).hostname)) return;
    } catch { return; }
    if (seen.has(href) || !title) return;
    seen.add(href);
    out.push({ title: title.trim().slice(0, 160), url: href, snippet: (snippet || '').replace(/\\s+/g, ' ').trim().slice(0, 300) });
  };
  for (const h of document.querySelectorAll('#search a h3, #rso a h3')) {
    const a = h.closest('a'); const box = h.closest('[data-hveid], .g, .MjjYud');
    push(a, h.innerText, box && box.querySelector('[data-sncf], .VwiC3b, [style*=\"-webkit-line-clamp\"]')?.innerText);
  }
  for (const a of document.querySelectorAll('a[data-testid=result-title-a], h2 a.result__a')) {
    const box = a.closest('article, .result'); push(a, a.innerText, box && box.querySelector('[data-result=snippet], .result__snippet, [data-testid=result-snippet]')?.innerText);
  }
  for (const a of document.querySelectorAll('#b_results .b_algo h2 a')) push(a, a.innerText, a.closest('.b_algo')?.querySelector('p')?.innerText);
  // Engines change their markup often; fall back to structure: an outbound link that carries a heading or a cite.
  if (out.length < 3) for (const a of document.querySelectorAll('a[href]')) {
    const head = a.querySelector('h3, h2, [role=heading]');
    if (!head && !a.querySelector('cite')) continue;
    const title = head ? head.innerText : a.innerText.split('\\n')[0];
    const box = a.closest('[data-hveid], .g, .MjjYud, [data-snc], li, article') || a.parentElement?.parentElement?.parentElement;
    let snippet = box && box.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]')?.innerText;
    if (!snippet && box) snippet = box.innerText.split('\\n').filter((l) => l.length > 60 && !a.innerText.includes(l)).sort((x, y) => y.length - x.length)[0];
    push(a, title, snippet);
  }
  return { results: out.slice(0, ${Number(max) || 8}), hidden: __h.hidden.join('\\n') };
  } finally { __h.restore(); }
})()`;

// Leaves out text a human can't see (see guard.HIDE_JS); returns that separately for the injection detector.
const READ_JS = `(() => {
  ${guard.HIDE_JS}
  const __h = __skHide();
  try {
    // Prefer the main content, but some sites keep their text outside <main> (JAL's notices, for one): then read the whole page.
    const main = [...document.querySelectorAll('main, article, [role=main]')].find((el) => !__h.isHidden(el));
    const pick = (el) => (el && el.innerText) || '';
    let text = pick(main);
    if (text.trim().length < 400) text = pick(document.body);
    return { text: text.replace(/\\n{3,}/g, '\\n\\n').trim(), hidden: __h.hidden.join('\\n'), title: document.title };
  } finally {
    __h.restore();
  }
})()`;

// ---------- helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(wc, timeout = 10000) {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, timeout);
    function done() {
      clearTimeout(t);
      wc.removeListener('did-stop-loading', done);
      resolve();
    }
    wc.once('did-stop-loading', done);
  });
}

async function settle(wc) {
  await sleep(350);
  await waitForLoad(wc);
  await sleep(150);
}

// Where plain words in the address bar (or from an AI) are searched. main.js sets it from Settings.
let searchTemplate = 'https://www.google.com/search?q=%s';
const setSearchTemplate = (t) => (searchTemplate = t);
// Optional search API for web_search ({ provider, key }); main.js sets it from Settings.
let searchApiConfig = null;
const setSearchApi = (c) => (searchApiConfig = c?.provider && c?.key ? c : null);

function toUrl(input) {
  const s = String(input).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:') || s.startsWith('file:')) return s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(\/|$|:|\?)/i.test(s)) return 'https://' + s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  return searchTemplate.replace('%s', encodeURIComponent(s));
}

// Where an AI's search lands: the engine's plain web results, without its AI overview or AI answer, so the AI reads
// real pages and cites them. Google's "Web" filter (udm=14) and DuckDuckGo's no-AI host; other URLs are unchanged.
// The user's own searches from the address bar keep the engine as they know it.
const DDG_NOAI = 'https://noai.duckduckgo.com/';
function webResultsUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/search' && u.searchParams.get('q') && !u.searchParams.has('udm') && !u.searchParams.has('tbm')) {
    u.searchParams.set('udm', '14');
    return u.toString();
  }
  if (/^(www\.)?duckduckgo\.com$/.test(u.hostname) && u.pathname === '/' && u.searchParams.get('q')) return DDG_NOAI + u.search;
  return url;
}
// toUrl for what an AI asks to open.
const aiUrl = (input) => webResultsUrl(toUrl(input));

const KEY_CODES = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace',
  delete: 'Delete', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down',
  arrowleft: 'Left', arrowright: 'Right', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End' };

// Page scripts can hang (e.g. a frame that never commits); never let one stall the AI.
function inFrame(frame, js, ms = 5000) {
  return Promise.race([
    frame.executeJavaScript(js),
    new Promise((_, reject) => setTimeout(() => reject(new Error('The page did not respond in time.')), ms)),
  ]);
}

// Read-only page scripts run in an isolated world, so a page can't tamper with innerText or getComputedStyle.
const WORLD_ID = 1917;
function inWorld(wc, js, ms = 5000) {
  if (typeof wc.executeJavaScriptInIsolatedWorld !== 'function') return inFrame(wc, js, ms);
  return Promise.race([
    wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: js }]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('The page did not respond in time.')), ms)),
  ]);
}

// ---------- injection guard: every page string an AI sees passes through here ----------
// `found` collects what the detector flagged during one tool call: { tabId, url, host, reasons, excerpt }.

function flag(found, tabId, url, r) {
  if (r.flagged) found.push({ tabId, url, host: guard.hostOf(url), reasons: r.reasons, excerpt: r.excerpt });
}

// Page text → stripped, redacted, fenced. `hidden` is what the page hid from people (scanned, never shown).
function fencePage(found, tabId, url, raw, hidden, max = 20000, label) {
  const r = guard.neutralise(raw, { hidden });
  flag(found, tabId, url, r);
  const text = r.text.length > max ? r.text.slice(0, max) + `\n…[truncated, ${r.text.length} chars total]` : r.text;
  return guard.wrap(label || guard.hostOf(url), text, r.reasons);
}

// Titles and other short page strings.
function short(found, tabId, url, s, max) {
  const r = guard.cleanShort(s, max);
  flag(found, tabId, url, r);
  return r.text;
}

// One entry per tab: the union of what was found there.
function summarise(found) {
  const byTab = new Map();
  for (const f of found) {
    const cur = byTab.get(f.tabId);
    if (!cur) byTab.set(f.tabId, { ...f, reasons: [...f.reasons] });
    else for (const r of f.reasons) if (!cur.reasons.includes(r)) cur.reasons.push(r);
  }
  const pages = [...byTab.values()];
  return { flagged: true, ...pages[0], pages };
}

// ---------- frames ----------

function frameById(wc, frameTreeNodeId) {
  if (frameTreeNodeId == null) return wc.mainFrame;
  return wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId === frameTreeNodeId && !f.detached) || null;
}

// Position of a frame's content inside the top-level viewport (walks up the frame tree).
async function frameOffset(frame, scrollIntoView = false) {
  const chain = [];
  try {
    for (let f = frame; f && f.parent; f = f.parent) chain.unshift(f);
  } catch {
    return null;
  }
  let x = 0;
  let y = 0;
  let rect = null;
  for (const child of chain) {
    let index;
    try {
      index = child.parent.frames.findIndex((f) => f.frameTreeNodeId === child.frameTreeNodeId);
    } catch {
      return null; // the frame went away mid-snapshot (ads reload their frames)
    }
    rect = await inFrame(child.parent, FRAME_RECT_JS(index, scrollIntoView)).catch(() => null);
    if (!rect) return null;
    x += rect.x;
    y += rect.y;
  }
  return { x, y, w: rect ? rect.w : Infinity, h: rect ? rect.h : Infinity };
}

// Find which frame holds element [id] (recorded at snapshot time).
function frameFor(tab, id) {
  const wc = tab.view.webContents;
  const ftn = tab.skillerrFrames && tab.skillerrFrames.get(Number(id));
  const frame = frameById(wc, ftn);
  if (!frame) throw new Error(`Element ${id} was in a frame that no longer exists. Take a new snapshot.`);
  return frame;
}

// ---------- snapshot ----------

async function snapshot(tab, fullPage = false, found = []) {
  const wc = tab.view.webContents;
  const main = wc.mainFrame;
  const frames = main.framesInSubtree.filter((f) => !f.detached).slice(0, 20);
  const [vw, vh] = [tab.view.getBounds().width, tab.view.getBounds().height];
  tab.skillerrFrames = new Map();
  let next = 1;
  let meta = null;
  const sections = [];
  for (const frame of frames) {
    const isMain = frame === main || frame.frameTreeNodeId === main.frameTreeNodeId;
    if (!isMain) {
      const off = await frameOffset(frame);
      if (!off || off.w < 20 || off.h < 20) continue;
      if (!fullPage && (off.x > vw || off.y > vh || off.x + off.w < 0 || off.y + off.h < 0)) continue;
    }
    let res;
    try {
      res = await inFrame(frame, SNAPSHOT_JS(!!fullPage, next));
    } catch {
      continue;
    }
    if (!res) continue;
    for (let id = next; id < res.next; id++) tab.skillerrFrames.set(id, frame.frameTreeNodeId);
    next = res.next;
    // Element names, values and labels are page text: strip, redact and check them like any other.
    const url = res.url || wc.getURL();
    const findings = [];
    const q = (v) => short(findings, tab.id, url, v, 90).replace(/"/g, '\u201d');
    res.lines = res.items.map((it) => {
      let extra = '';
      if (it.checked != null) extra = it.checked ? ' [checked]' : ' [unchecked]';
      if (it.value) extra += ` value="${q(it.value)}"`;
      if (it.placeholder) extra += ` placeholder="${q(it.placeholder)}"`;
      if (it.selected != null) extra += ` selected="${q(it.selected)}"`;
      if (it.disabled) extra += ' [disabled]';
      return `[${it.id}] ${it.role} "${q(it.name)}"${extra}${it.inView ? '' : ' (offscreen)'}`;
    });
    if (res.hidden) flag(findings, tab.id, url, guard.neutralise('', { hidden: res.hidden }));
    found.push(...findings);
    res.reasons = [...new Set(findings.flatMap((f) => f.reasons))];
    if (isMain) meta = res;
    else if (res.lines.length) {
      let host = '';
      try {
        host = new URL(res.url).host;
      } catch {}
      sections.push(`-- inside embedded frame (${host || 'frame'}) --`);
    }
    sections.push(...res.lines);
  }
  if (!meta) meta = { url: wc.getURL(), title: wc.getTitle(), scrollable: false };
  const count = next - 1;
  const reasons = [...new Set(found.filter((f) => f.tabId === tab.id).flatMap((f) => f.reasons))];
  return `URL: ${meta.url}\nTitle: ${short(found, tab.id, meta.url, meta.title, 200)}\n` +
    (meta.scrollable ? `Scroll: ${meta.scroll}% down the page\n` : '') +
    `Interactive elements${fullPage ? '' : ' in view'} (${count}):\n` +
    guard.wrap(guard.hostOf(meta.url), sections.map(guard.escapeMarkers).join('\n') || '(none)', reasons);
}

// ---------- acting ----------

async function locate(tab, id, visible) {
  const frame = frameFor(tab, id);
  if (visible && frame.parent) await frameOffset(frame, true); // bring the frame into view first
  const pos = await inFrame(frame, LOCATE_JS(Number(id))).catch(() => null);
  if (!pos) throw new Error(`No element with id ${id}. The page may have changed — take a new snapshot.`);
  await sleep(120);
  const fresh = (await inFrame(frame, LOCATE_JS(Number(id))).catch(() => null)) || pos;
  const off = frame.parent ? await frameOffset(frame) : { x: 0, y: 0 };
  if (!off) throw new Error('Could not locate the frame holding this element.');
  return { frame, x: Math.round(off.x + fresh.x), y: Math.round(off.y + fresh.y) };
}

async function clickAt(tab, id, visible) {
  const wc = tab.view.webContents;
  const { frame, x, y } = await locate(tab, id, visible);
  tab.lastFrame = frame.frameTreeNodeId;
  if (!visible) {
    // Background tabs don't receive real input; fall back to a DOM click.
    await inFrame(frame, `(() => { ${DEEP} const el = deepFind('[data-skillerr-id="${Number(id)}"]'); if (el) { el.focus(); el.click(); } })()`);
    return;
  }
  await clickPoint(wc, x, y);
}

// A real click at page coordinates (CSS pixels, top-level viewport), with the ghost cursor.
async function clickPoint(wc, x, y) {
  await inFrame(wc, CURSOR_JS(x, y)).catch(() => {});
  await sleep(300);
  // Page coordinates are CSS pixels; input events use view pixels (they differ when a fleet tile is zoomed out).
  const z = wc.getZoomFactor();
  const at = { x: Math.round(x * z), y: Math.round(y * z) };
  // Mark this click as the AI's, so fleet view doesn't treat it as the user picking a tile.
  wc.skillerrAiInputAt = Date.now();
  await wc.executeJavaScript('window.__skillerrAiAt = Date.now()').catch(() => {});
  wc.sendInputEvent({ type: 'mouseMove', ...at });
  wc.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
}

async function pressKey(tab, key, visible) {
  const wc = tab.view.webContents;
  const keyCode = KEY_CODES[String(key).toLowerCase()] || key;
  if (visible) {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    return;
  }
  const frame = frameById(wc, tab.lastFrame) || wc.mainFrame;
  await inFrame(frame, `(() => {
    const el = document.activeElement || document.body;
    const k = ${JSON.stringify(keyCode)};
    for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, bubbles: true, cancelable: true }));
    if (k === 'Enter' && el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  })()`);
}

// ---------- uploads: files from the user's disk into a page, through the DevTools protocol ----------
// The path checks live in uploads.js; main.js asks the user before this ever runs.

// The element the AI pointed at: a file input (itself, a <label> for one, or a wrapper holding one) is tagged with
// `key` so the protocol side can find it; anything else is a button that opens a picker, and we return where it is.
const UPLOAD_PROBE_JS = (selector, key) => `(() => {
  ${DEEP}
  let el;
  try { el = deepFind(${JSON.stringify(selector)}); } catch { return { error: 'bad selector' }; }
  if (!el) return null;
  const isFile = (n) => !!n && n.tagName === 'INPUT' && String(n.type).toLowerCase() === 'file';
  let input = isFile(el) ? el : el.tagName === 'LABEL' && isFile(el.control) ? el.control : null;
  if (!input && el.querySelectorAll) { const inner = el.querySelectorAll('input[type=file]'); if (inner.length === 1) input = inner[0]; }
  if (input) {
    input.setAttribute('data-skillerr-upload', ${JSON.stringify(key)});
    return { input: true, multiple: input.multiple, accept: input.accept || '', disabled: input.disabled };
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { input: false, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// Runs in the top frame over the protocol: the tagged input, looking through open shadow roots and same-origin frames.
const UPLOAD_FIND_JS = (key) => `(() => {
  const find = (root) => {
    const hit = root.querySelector('[data-skillerr-upload=${JSON.stringify(key)}]');
    if (hit) return hit;
    for (const h of root.querySelectorAll('*')) {
      let sub = h.shadowRoot;
      if (!sub && (h.tagName === 'IFRAME' || h.tagName === 'FRAME')) { try { sub = h.contentDocument; } catch {} }
      const x = sub && find(sub);
      if (x) return x;
    }
    return null;
  };
  return find(document);
})()`;

async function withDebugger(wc, fn) {
  const dbg = wc.debugger;
  const mine = !dbg.isAttached();
  if (mine) dbg.attach('1.3');
  try {
    return await fn(dbg);
  } finally {
    if (mine) try { dbg.detach(); } catch {}
  }
}

function nextEvent(dbg, method, ms) {
  return new Promise((resolve) => {
    const onMsg = (_e, m, params) => { if (m === method) finish(params); };
    const timer = setTimeout(() => finish(null), ms);
    function finish(v) {
      clearTimeout(timer);
      dbg.removeListener('message', onMsg);
      resolve(v);
    }
    dbg.on('message', onMsg);
  });
}

// Set `files` (checked real paths) on the element; returns the file names the input now holds.
async function uploadFiles(tab, args, files, visible) {
  const wc = tab.view.webContents;
  const byId = args.id != null;
  if (!byId && !String(args.selector || '').trim()) throw new Error('Say which element to attach to: its [id] from the snapshot, or a selector like "input[type=file]".');
  const frame = byId ? frameFor(tab, args.id) : wc.mainFrame;
  const selector = byId ? `[data-skillerr-id="${Number(args.id)}"]` : String(args.selector);
  const key = Math.random().toString(36).slice(2, 10);
  const probe = await inFrame(frame, UPLOAD_PROBE_JS(selector, key));
  if (probe?.error) throw new Error(`“${args.selector}” is not a valid CSS selector.`);
  if (!probe) throw new Error(byId ? `No element with id ${args.id}. Take a new snapshot.` : `Nothing on the page matches “${args.selector}”.`);
  if (probe.input && probe.disabled) throw new Error('That file input is disabled.');
  if (probe.input && !probe.multiple && files.length > 1) throw new Error('That file input takes one file. Attach one at a time, or find the input that takes several.');

  return withDebugger(wc, async (dbg) => {
    const send = (m, p) => dbg.sendCommand(m, p);
    let target; // { objectId } or { backendNodeId }
    if (probe.input) {
      const { result } = await send('Runtime.evaluate', { expression: UPLOAD_FIND_JS(key) });
      if (!result?.objectId) throw new Error('That file input is inside a frame from another site, which Skillerr can\'t reach. Click the page\'s own upload button instead, or ask the user to attach the file.');
      target = { objectId: result.objectId };
    } else {
      // A button that opens the system file picker: catch the picker instead of showing it, then fill it in.
      if (!visible) throw new Error(`Tab ${tab.id} is in the background, and this button opens a file picker. Use switch_tab first, or pass the file input itself with selector "input[type=file]".`);
      await send('Page.enable');
      await send('Page.setInterceptFileChooserDialog', { enabled: true });
      try {
        const opened = nextEvent(dbg, 'Page.fileChooserOpened', 5000);
        if (byId) await clickAt(tab, args.id, true);
        else await clickPoint(wc, Math.round(probe.x), Math.round(probe.y));
        const ev = await opened;
        if (!ev) throw new Error('Clicking that did not open a file picker. Take a snapshot and try the file input itself (selector "input[type=file]").');
        if (ev.mode === 'selectSingle' && files.length > 1) throw new Error('This picker takes one file. Attach one at a time.');
        if (ev.backendNodeId == null) throw new Error('The file picker came from a part of the page Skillerr can\'t reach. Ask the user to attach the file.');
        target = { backendNodeId: ev.backendNodeId };
      } finally {
        await send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
    }
    await send('DOM.setFileInputFiles', { files: files.map((f) => f.path), ...target });
    let objectId = target.objectId;
    if (!objectId) objectId = (await send('DOM.resolveNode', { backendNodeId: target.backendNodeId }).catch(() => null))?.object?.objectId;
    const names = objectId
      ? (await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function () { this.removeAttribute("data-skillerr-upload"); return [...(this.files || [])].map((f) => f.name); }', returnByValue: true })
        .catch(() => null))?.result?.value
      : null;
    return Array.isArray(names) ? names : files.map((f) => f.name);
  });
}

// ---------- tool implementations ----------
// `browser` comes from main.js: { active(), get(id), isVisible(tab), newTab(url, opts), switchTab(id), closeTab(id), listTabs() }.
// Every tool returns { text, image? }.

function resolveTab(browser, args) {
  const tab = args.tab_id != null ? browser.get(Number(args.tab_id)) : browser.active();
  if (!tab) throw new Error(args.tab_id != null ? `No tab ${args.tab_id}. Use list_tabs.` : 'No open tab');
  return tab;
}

// Runs a tool. When page text in the result was addressed to an AI, the result carries `injection`:
// { flagged: true, tabId, url, host, reasons: [..], excerpt, pages: [{ tabId, url, host, reasons, excerpt }, ..] }
// (one entry in `pages` per tab; read_tabs can flag several). The offending text is already removed from `text`.
async function runTool(browser, name, args = {}) {
  const found = [];
  const result = await runPageTool(browser, name, args, found);
  if (found.length && result) {
    result.injection = summarise(found);
    try {
      injectionHandler?.(result.injection, name);
    } catch {}
  }
  return result;
}

// Optional: main.js may prefer a callback to reading result.injection. Called with (injection, toolName).
let injectionHandler = null;
const setInjectionHandler = (fn) => (injectionHandler = fn);

async function runPageTool(browser, name, args, found) {
  switch (name) {
    case 'list_tabs':
      return { text: browser.listTabs().map((t) => `${t.active ? '*' : ' '} tab ${t.id}: ${short(found, t.id, t.url, t.title, 200)} — ${t.url || '(new tab)'}` +
        (t.group ? `  [group: ${t.group.title}]` : '') + (t.asleep ? '  (sleeping; wakes when used)' : '')).join('\n') };
    case 'new_tab': {
      const t = browser.newTab(args.url ? aiUrl(args.url) : undefined);
      await settle(t.view.webContents);
      return { text: `Opened tab ${t.id}.\n${await snapshot(t, false, found)}` };
    }
    case 'switch_tab':
      browser.switchTab(Number(args.tab_id));
      return { text: `Switched to tab ${args.tab_id}.\n${await snapshot(browser.active(), false, found)}` };
    case 'close_tab':
      browser.closeTab(args.tab_id != null ? Number(args.tab_id) : browser.active().id);
      return { text: 'Tab closed.' };
    case 'open_tabs': {
      const urls = (args.urls || []).slice(0, 10);
      if (!urls.length) throw new Error('Give at least one URL.');
      const opened = urls.map((u) => browser.newTab(aiUrl(u), { background: true }));
      browser.onOpened?.(opened.map((t) => t.id)); // show them right away, loading live
      await Promise.all(opened.map((t) => settle(t.view.webContents)));
      return { text: opened.map((t) => `tab ${t.id}: ${short(found, t.id, t.view.webContents.getURL(), t.view.webContents.getTitle(), 200) || '(loading)'} — ${t.view.webContents.getURL()}`).join('\n') };
    }
    case 'read_tabs': {
      const all = browser.listTabs().filter((t) => !t.isStart);
      const ids = args.tab_ids && args.tab_ids.length ? args.tab_ids.map(Number) : all.map((t) => t.id);
      const parts = await Promise.all(ids.map(async (id) => {
        const t = browser.get(id);
        if (!t) return `## tab ${id}\n(no such tab)`;
        await browser.awake?.(t);
        const wc = t.view.webContents;
        const url = wc.getURL();
        const page = await inWorld(wc, READ_JS).catch((e) => ({ error: e.message }));
        const body = page.error ? `(could not read: ${page.error})` : fencePage(found, id, url, page.text, page.hidden, 8000);
        return `## tab ${id}: ${short(found, id, url, wc.getTitle(), 200)} — ${url}\n${body}`;
      }));
      return { text: parts.join('\n\n') };
    }
    case 'dispatch':
    case 'list_skills':
    case 'use_skill':
    case 'record_start':
    case 'caption':
    case 'record_stop':
    case 'show_tabs':
    case 'say':
    case 'save_note':
    case 'save_skill':
    case 'recall':
    case 'tag_session':
    case 'deep_research':
    case 'my_research':
    case 'my_trails':
    case 'continue_trail':
    case 'read_note':
    case 'open_view':
    case 'save_screenshot':
    case 'view_capture':
      throw new Error(`${name} is handled by the browser, not the tool layer`);
  }

  const tab = resolveTab(browser, args);
  await browser.awake?.(tab);
  const wc = tab.view.webContents;
  const visible = browser.isVisible(tab);
  const where = args.tab_id != null ? ` (tab ${tab.id})` : '';

  switch (name) {
    case 'snapshot':
      return { text: await snapshot(tab, args.full_page, found) };

    case 'navigate': {
      const target = aiUrl(args.url || '');
      await wc.loadURL(target).catch(() => {}); // redirects reject with ERR_ABORTED; state comes from the snapshot
      await settle(wc);
      // Google sometimes answers automated searches with a robot check. Don't try to pass it: run this search elsewhere.
      if (target !== String(args.url || '').trim() && /^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(wc.getURL())) {
        await wc.loadURL(DDG_NOAI + '?q=' + encodeURIComponent(String(args.url || ''))).catch(() => {});
        await settle(wc);
        return { text: `Google asked for a robot check, so this search ran on DuckDuckGo instead${where}.\n${await snapshot(tab, false, found)}` };
      }
      return { text: `Navigated${where}.\n${await snapshot(tab, false, found)}` };
    }

    case 'click':
      await clickAt(tab, args.id, visible);
      await settle(wc);
      if (browser.isRecording?.(tab)) await sleep(500); // let viewers see what the click did
      return { text: `Clicked [${args.id}]${where}.\n${await snapshot(tab, false, found)}` };

    case 'type': {
      const text = String(args.text ?? '');
      const frame = frameFor(tab, args.id);
      if (visible) {
        await clickAt(tab, args.id, true);
        await sleep(80);
        await inFrame(frame, `(() => {
          ${DEEP}
          const el = deepFind('[data-skillerr-id="${Number(args.id)}"]');
          if (!el) return;
          el.focus();
          if (typeof el.select === 'function') el.select();
          else if (el.isContentEditable) document.execCommand('selectAll');
        })()`);
        if (browser.isRecording?.(tab)) {
          // On camera, type like a person so viewers can follow.
          for (const ch of text) {
            await wc.insertText(ch);
            await sleep(28 + Math.random() * 30);
          }
        } else await wc.insertText(text);
      } else {
        tab.lastFrame = frame.frameTreeNodeId;
        const ok = await inFrame(frame, SET_VALUE_JS(`[data-skillerr-id="${Number(args.id)}"]`, text));
        if (!ok) throw new Error(`No element with id ${args.id}. Take a new snapshot.`);
      }
      if (args.submit) {
        await sleep(60);
        await pressKey(tab, 'Enter', visible);
        await settle(wc);
        return { text: `Typed into [${args.id}] and pressed Enter${where}.\n${await snapshot(tab, false, found)}` };
      }
      return { text: `Typed "${text.slice(0, 60)}" into [${args.id}]${where}.` };
    }

    case 'select_option': {
      const frame = frameFor(tab, args.id);
      const res = await inFrame(frame, `(() => {
        ${DEEP}
        const el = deepFind('[data-skillerr-id="${Number(args.id)}"]');
        if (!el || el.tagName !== 'SELECT') return 'not a select';
        const want = ${JSON.stringify(String(args.option || '')).toLowerCase()};
        const opt = [...el.options].find(o => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
          || [...el.options].find(o => o.text.toLowerCase().includes(want));
        if (!opt) return 'no option matching; options: ' + [...el.options].slice(0, 100).map(o => o.text.trim()).join(' | ');
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'selected "' + opt.text.trim() + '"';
      })()`);
      return { text: short(found, tab.id, frame.url, res, 4000) + where };
    }

    case 'upload_file': {
      const files = uploads.checkPaths(args.paths); // checked again here: what was approved must still be allowed
      const names = await uploadFiles(tab, args, files, visible);
      await settle(wc);
      const host = /^file:/.test(wc.getURL()) ? wc.getURL().split('/').pop() : guard.hostOf(wc.getURL());
      const on = args.id != null ? `[${args.id}]` : `“${args.selector}”`;
      return { text: `Attached ${uploads.namesText(files.map((f) => f.name))} to ${on} on ${host}${where}. The input now holds: ` +
        `${short(found, tab.id, wc.getURL(), names.join(', ') || '(nothing)', 400)}. Take a snapshot to see the page's preview before posting.` };
    }

    case 'press_key':
      await pressKey(tab, args.key, visible);
      await settle(wc);
      return { text: `Pressed ${args.key}${where}.` };

    case 'scroll': {
      const amount = Number(args.amount) || 0;
      await inFrame(wc, `window.scrollBy({ top: ${args.direction === 'up' ? -1 : 1} * (${amount} || innerHeight * 0.85), behavior: 'instant' })`);
      await sleep(250);
      return { text: `Scrolled ${args.direction}${where}.\n${await snapshot(tab, false, found)}` };
    }

    case 'web_search': {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('Give a search query.');
      let apiNote = '';
      if (searchApiConfig) {
        const max = Math.min(Math.max(Number(args.max_results) || 8, 1), 20);
        try {
          const results = await searchApi({ ...searchApiConfig, query: q, max });
          await wc.loadURL(resultsPage(searchApiConfig.provider, q, results)).catch(() => {});
          const via = PROVIDERS[searchApiConfig.provider].name;
          if (!results.length) return { text: `No results from ${via} for “${q}”${where}.` };
          const list = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n');
          return { text: `Search results for “${q}”${where} (${via}):\n` + fencePage(found, tab.id, wc.getURL(), list, '', 20000, `search results from ${via}`) };
        } catch (err) {
          apiNote = ` (${err.message}; searched the web page instead)`; // bad key, quota or offline: fall back to the results page
        }
      }
      await wc.loadURL(aiUrl(q.includes(' ') || !/\./.test(q) ? q : `"${q}"`)).catch(() => {});
      await settle(wc);
      if (/^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(wc.getURL())) { // Google wants a robot check: search elsewhere instead
        await wc.loadURL(DDG_NOAI + '?q=' + encodeURIComponent(q)).catch(() => {});
        await settle(wc);
      }
      await sleep(400);
      const page = await inWorld(wc, RESULTS_JS(args.max_results)).catch(() => ({ results: [], hidden: '' }));
      const results = page.results || [];
      await Promise.all(results.map(async (r) => (r.url = await resolveRedirect(wc, r.url))));
      if (!results.length) return { text: `Searched “${q}”${where}${apiNote} but couldn't pick out results. Use read_page or snapshot on this tab.` };
      // Titles and snippets come from other sites: each line is checked (and redacted) on its own.
      const list = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n');
      return { text: `Search results for “${q}”${where} (${wc.getURL().split('/')[2]}${apiNote}):\n` +
        fencePage(found, tab.id, wc.getURL(), list, page.hidden, 20000, 'search results (titles and snippets from the sites listed)') };
    }

    case 'fetch_page': {
      // A tab opened for this fetch is still loading its blank page: let that finish first, or it can land after the real
      // page and leave the tab blank (the fetch then reads about:blank).
      if (wc.isLoading()) await waitForLoad(wc);
      await wc.loadURL(aiUrl(args.url || '')).catch(() => {});
      await settle(wc);
      const page = await inWorld(wc, READ_JS).catch(() => ({ text: '', hidden: '' }));
      const url = wc.getURL();
      return { text: `URL: ${url}\nTitle: ${short(found, tab.id, url, wc.getTitle(), 200)}${where}\n\n` + fencePage(found, tab.id, url, page.text, page.hidden) };
    }

    case 'read_page': {
      const page = await inWorld(wc, READ_JS);
      const url = wc.getURL();
      return { text: `URL: ${url}\n\n` + fencePage(found, tab.id, url, page.text, page.hidden) };
    }

    case 'screenshot': {
      if (!visible) throw new Error(`Tab ${tab.id} is in the background. Use switch_tab first, or read_page instead.`);
      const img = await wc.capturePage();
      const scaled = img.getSize().width > 1280 ? img.resize({ width: 1280 }) : img;
      return { text: `Screenshot of ${wc.getURL()}`, image: { data: scaled.toJPEG(75).toString('base64'), mimeType: 'image/jpeg' } };
    }

    case 'go_back':
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      await settle(wc);
      return { text: `Went back${where}.\n${await snapshot(tab, false, found)}` };

    case 'go_forward':
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      await settle(wc);
      return { text: `Went forward${where}.\n${await snapshot(tab, false, found)}` };

    case 'wait':
      await sleep(Math.min(Number(args.ms) || 1000, 10000));
      await waitForLoad(wc);
      return { text: 'Waited.' };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Look at the element an action targets before running it: label for the activity feed,
// sensitivity for the approval gate, and current value for undo. Tags it with undoKey.
async function inspectTarget(browser, name, args, undoKey) {
  if (!['click', 'type', 'select_option', 'press_key', 'upload_file'].includes(name)) return null;
  if (name === 'upload_file' && args.id == null) return null;
  let tab;
  try {
    tab = resolveTab(browser, args);
  } catch {
    return null;
  }
  const wc = tab.view.webContents;
  let frame;
  if (name === 'press_key') frame = frameById(wc, tab.lastFrame) || wc.mainFrame;
  else {
    try {
      frame = frameFor(tab, args.id);
    } catch {
      return null;
    }
  }
  const info = await inFrame(frame, INSPECT_JS(name === 'press_key' ? null : Number(args.id), undoKey)).catch(() => null);
  if (!info) return null;
  // Pressing Enter / submitting inside a sign-in form counts as submitting it.
  if (!info.sensitive && info.formHasPassword && (name === 'press_key' ? /enter|return/i.test(args.key) : name === 'type' && args.submit)) {
    info.sensitive = 'submitting a sign-in form';
  }
  if (name === 'press_key' && !/enter|return/i.test(args.key)) info.sensitive = null;
  if (name === 'upload_file') info.sensitive = null; // uploads always ask anyway, with their own reason (main.js)
  info.frameId = frame.frameTreeNodeId;
  info.frameUrl = frame.url;
  return info;
}

// Put a form control back to an earlier value (used by undo).
async function restoreValue(tab, frameId, undoKey, value) {
  const frame = frameById(tab.view.webContents, frameId);
  if (!frame) return false;
  return inFrame(frame, SET_VALUE_JS(`[data-skillerr-undo="${undoKey}"]`, value)).catch(() => false);
}

module.exports = { TOOLS, runTool, toUrl, aiUrl, webResultsUrl, setSearchTemplate, setSearchApi, inspectTarget, restoreValue, setInjectionHandler,
  // For tests and for main.js's own page reads (deep research): the exact page scripts and guard the tools use.
  READ_JS, RESULTS_JS, SNAPSHOT_JS, inWorld, fencePage, guard };
