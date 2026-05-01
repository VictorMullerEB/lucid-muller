// ============================================================
// LucidMuller - UML Diagram Editor
// ============================================================

const STORAGE_KEY = 'lucidmuller_diagrams';

let state = {
  diagrams: [], currentId: null,
  elements: [], connections: [],
  selected: [],
  tool: 'select', shapeTool: 'rectangle', connectorType: 'arrow',
  zoom: 1, panX: 0, panY: 0, showGrid: true,
  history: [], historyIndex: -1,
  dragging: null, resizing: null,
  panning: false, rightPanning: false, _rightPanMoved: false,
  connecting: null, selectionBox: null,
  draggingSegment: null,    // { connId, segIdx, axis, origWaypoints }
  draggingEndpoint: null,   // { connId, which:'from'|'to' }
  pendingSegDrag: null,     // { connId, segIdx, axis, startX, startY } — activated after threshold
  hoveredConnId: null,      // id of connection under cursor (for hover handles)
  nextId: 1,
};

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  if (state.diagrams.length === 0) newDiagram();
  else openDiagram(state.diagrams[0].id);
  renderDiagramsList();
  setupCanvasEvents();
  setupKeyboard();
});

// ---- Storage ----
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const d = JSON.parse(raw); state.diagrams = d.diagrams || []; state.nextId = d.nextId || 1; }
  } catch(e) {}
}
function saveToStorage() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ diagrams: state.diagrams, nextId: state.nextId })); }
function getCurrentDiagram() { return state.diagrams.find(d => d.id === state.currentId); }
function persistCurrentDiagram() {
  const d = getCurrentDiagram(); if (!d) return;
  d.elements = JSON.parse(JSON.stringify(state.elements));
  d.connections = JSON.parse(JSON.stringify(state.connections));
  d.panX = state.panX; d.panY = state.panY; d.zoom = state.zoom;
  d.updated = new Date().toISOString(); saveToStorage();
}

// ---- Diagrams ----
function newDiagram() {
  persistCurrentDiagram();
  const id = 'diag_' + Date.now();
  state.diagrams.unshift({ id, name: 'Sem título', elements: [], connections: [], panX: 0, panY: 0, zoom: 1, created: new Date().toISOString(), updated: new Date().toISOString() });
  saveToStorage(); openDiagram(id); renderDiagramsList();
}
function openDiagram(id) {
  persistCurrentDiagram(); state.currentId = id;
  const d = getCurrentDiagram(); if (!d) return;
  state.elements = JSON.parse(JSON.stringify(d.elements || []));
  state.connections = JSON.parse(JSON.stringify(d.connections || []));
  state.panX = d.panX||0; state.panY = d.panY||0; state.zoom = d.zoom||1;
  state.selected = []; state.history = []; state.historyIndex = -1;
  document.getElementById('diagram-name-display').textContent = d.name;
  renderAll(); renderDiagramsList(); updateZoomDisplay();
}
function deleteDiagramFromList(id, e) {
  e.stopPropagation();
  if (!confirm('Excluir este diagrama?')) return;
  state.diagrams = state.diagrams.filter(d => d.id !== id); saveToStorage();
  if (state.currentId === id) { if (state.diagrams.length > 0) openDiagram(state.diagrams[0].id); else newDiagram(); }
  renderDiagramsList();
}
function renderDiagramsList() {
  const list = document.getElementById('diagrams-list'); list.innerHTML = '';
  state.diagrams.forEach(d => {
    const el = document.createElement('div');
    el.className = 'diagram-item' + (d.id === state.currentId ? ' active' : '');
    el.innerHTML = `<span>${escHtml(d.name)}</span><button class="del-btn" onclick="deleteDiagramFromList('${d.id}', event)">×</button>`;
    el.addEventListener('click', () => openDiagram(d.id)); list.appendChild(el);
  });
}
function renameDiagram() { const d = getCurrentDiagram(); if (!d) return; document.getElementById('rename-input').value = d.name; showModal('modal-rename'); }
function confirmRename() {
  const val = document.getElementById('rename-input').value.trim(); if (!val) return;
  const d = getCurrentDiagram(); if (!d) return;
  d.name = val; document.getElementById('diagram-name-display').textContent = val; saveToStorage(); renderDiagramsList(); closeModal();
}

// ---- History ----
function pushHistory() {
  const snap = { elements: JSON.parse(JSON.stringify(state.elements)), connections: JSON.parse(JSON.stringify(state.connections)) };
  state.history = state.history.slice(0, state.historyIndex + 1); state.history.push(snap); state.historyIndex = state.history.length - 1;
}
function undo() {
  if (state.historyIndex <= 0) return; state.historyIndex--;
  const s = state.history[state.historyIndex];
  state.elements = JSON.parse(JSON.stringify(s.elements)); state.connections = JSON.parse(JSON.stringify(s.connections));
  state.selected = []; renderAll(); persistCurrentDiagram();
}
function redo() {
  if (state.historyIndex >= state.history.length - 1) return; state.historyIndex++;
  const s = state.history[state.historyIndex];
  state.elements = JSON.parse(JSON.stringify(s.elements)); state.connections = JSON.parse(JSON.stringify(s.connections));
  state.selected = []; renderAll(); persistCurrentDiagram();
}

// ---- ID ----
function genId() { return 'el_' + (state.nextId++); }

// ---- Tools ----
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t); if (btn) btn.classList.add('active');
  const c = document.getElementById('canvas-container');
  c.style.cursor = t === 'pan' ? 'grab' : t === 'connect' ? 'crosshair' : t === 'text' ? 'text' : 'default';
}
function setShapeTool(shape) {
  state.shapeTool = shape; state.tool = 'shape';
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('canvas-container').style.cursor = 'crosshair';
}
function setConnectorType(v) { state.connectorType = v; }

// ---- Coords ----
function svgCoords(e) {
  const svg = document.getElementById('canvas'), r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - state.panX) / state.zoom, y: (e.clientY - r.top - state.panY) / state.zoom };
}
function clientCoords(e) {
  const svg = document.getElementById('canvas'), r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ============================================================
// ---- PORT / ROUTING SYSTEM ----
// ============================================================

/** Returns the exact point on an element's edge for a given port side */
function getPortPoint(el, port) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  if (port === 'n') return { x: cx,           y: el.y };
  if (port === 's') return { x: cx,           y: el.y + el.h };
  if (port === 'e') return { x: el.x + el.w,  y: cy };
  if (port === 'w') return { x: el.x,          y: cy };
  return { x: cx, y: cy };
}

/** Returns all 4 port points of an element */
function getAllPorts(el) {
  return [
    { id: 'n', ...getPortPoint(el, 'n') },
    { id: 's', ...getPortPoint(el, 's') },
    { id: 'e', ...getPortPoint(el, 'e') },
    { id: 'w', ...getPortPoint(el, 'w') },
  ];
}

/** Auto-pick best port on `el` toward a reference point */
function getBestPort(el, refPt) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const dx = refPt.x - cx, dy = refPt.y - cy;
  const normX = Math.abs(dx) / (el.w / 2 || 1), normY = Math.abs(dy) / (el.h / 2 || 1);
  if (normX >= normY) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** Snap a point to the nearest port of an element; returns port id */
function snapToNearestPort(el, pt) {
  let best = 'auto', bestDist = Infinity;
  getAllPorts(el).forEach(p => {
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d < bestDist) { bestDist = d; best = p.id; }
  });
  return best;
}

// ---- Routing constants ----
const STUB = 22; // clearance stub (px) that always exits perpendicular from element edge

/** Direction vector for a port */
function portDir(port) {
  return ({n:{x:0,y:-1},s:{x:0,y:1},e:{x:1,y:0},w:{x:-1,y:0}})[port] || {x:1,y:0};
}

/** Point STUB px outside the element along a port's direction */
function stubPt(basePt, port) {
  const d = portDir(port);
  return { x: basePt.x + d.x * STUB, y: basePt.y + d.y * STUB };
}

/** Remove consecutive duplicate / near-duplicate points */
function dedupPts(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (Math.abs(p.x - q.x) > 0.4 || Math.abs(p.y - q.y) > 0.4) out.push(p);
  }
  return out;
}

/**
 * Score a path of orthogonal segments against elements.
 * Higher score = worse (intersections penalised heavily).
 */
function routeScore(pts, fromEl, toEl) {
  let score = 0, length = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    length += Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
    state.elements.forEach(el => {
      if (segHitsRect(p1, p2, el, 3)) {
        score += (el.id === fromEl.id || el.id === toEl.id) ? 2e6 : 5000;
      }
    });
  }
  return score + length;
}

/** Returns true if an axis-aligned segment p1→p2 passes through rect el (with padding). */
function segHitsRect(p1, p2, el, pad = 0) {
  const bx = el.x - pad, by = el.y - pad, bx2 = el.x + el.w + pad, by2 = el.y + el.h + pad;
  if (Math.abs(p1.y - p2.y) < 0.5) {            // horizontal segment
    if (p1.y <= by || p1.y >= by2) return false;
    const lo = Math.min(p1.x, p2.x), hi = Math.max(p1.x, p2.x);
    return hi > bx && lo < bx2;
  }
  if (Math.abs(p1.x - p2.x) < 0.5) {            // vertical segment
    if (p1.x <= bx || p1.x >= bx2) return false;
    const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
    return hi > by && lo < by2;
  }
  return false;
}

/**
 * Build candidate X positions (for HH routing) or Y positions (for VV routing)
 * derived from element edges so the path can go around obstacles.
 */
function edgeCandidates(axis) {
  const cands = new Set();
  state.elements.forEach(el => {
    if (axis === 'x') { cands.add(el.x - STUB); cands.add(el.x + el.w + STUB); }
    else              { cands.add(el.y - STUB); cands.add(el.y + el.h + STUB); }
  });
  return [...cands];
}

/** Route middle section when both exits are horizontal (E or W) → Z-shape (H-V-H). */
function midHH(se, de, fromEl, toEl) {
  const def = (se.x + de.x) / 2;
  const cands = [def, ...edgeCandidates('x')];
  let bestX = def, bestScore = Infinity;
  cands.forEach(cx => {
    const pts = [se, { x: cx, y: se.y }, { x: cx, y: de.y }, de];
    const s = routeScore(pts, fromEl, toEl);
    if (s < bestScore) { bestScore = s; bestX = cx; }
  });
  return [{ x: bestX, y: se.y }, { x: bestX, y: de.y }];
}

/** Route middle section when both exits are vertical (N or S) → Z-shape (V-H-V). */
function midVV(se, de, fromEl, toEl) {
  const def = (se.y + de.y) / 2;
  const cands = [def, ...edgeCandidates('y')];
  let bestY = def, bestScore = Infinity;
  cands.forEach(cy => {
    const pts = [se, { x: se.x, y: cy }, { x: de.x, y: cy }, de];
    const s = routeScore(pts, fromEl, toEl);
    if (s < bestScore) { bestScore = s; bestY = cy; }
  });
  return [{ x: se.x, y: bestY }, { x: de.x, y: bestY }];
}

/** Route middle section for H→V (one corner). Falls back to HH if direct is blocked. */
function midHV(se, de, fromEl, toEl) {
  const direct = [se, { x: de.x, y: se.y }, de];
  const alt    = [se, { x: se.x, y: de.y }, de];
  if (routeScore(direct, fromEl, toEl) <= routeScore(alt, fromEl, toEl))
    return [{ x: de.x, y: se.y }];
  return [{ x: se.x, y: de.y }];
}

/** Route middle section for V→H. */
function midVH(se, de, fromEl, toEl) {
  const direct = [se, { x: se.x, y: de.y }, de];
  const alt    = [se, { x: de.x, y: se.y }, de];
  if (routeScore(direct, fromEl, toEl) <= routeScore(alt, fromEl, toEl))
    return [{ x: se.x, y: de.y }];
  return [{ x: de.x, y: se.y }];
}

/**
 * Compute the best auto-route for a connection without custom waypoints.
 * Tries all 16 port combinations when ports are 'auto', picks best score.
 */
function autoRoute(srcPt, srcPort, dstPt, dstPort, fromEl, toEl, tryAllPorts) {
  if (tryAllPorts) {
    // Score all 16 port pairs and pick winner
    const PORTS = ['n','s','e','w'];
    let best = null, bestScore = Infinity;
    PORTS.forEach(fp => {
      PORTS.forEach(tp => {
        const sp = getPortPoint(fromEl, fp), dp = getPortPoint(toEl, tp);
        const se = stubPt(sp, fp), de = stubPt(dp, tp);
        const pts = buildAutoPath(sp, se, de, dp, fp, tp, fromEl, toEl);
        const s = routeScore(pts, fromEl, toEl);
        if (s < bestScore) { bestScore = s; best = { fp, tp, pts }; }
      });
    });
    return best.pts;
  }
  const se = stubPt(srcPt, srcPort), de = stubPt(dstPt, dstPort);
  return buildAutoPath(srcPt, se, de, dstPt, srcPort, dstPort, fromEl, toEl);
}

function buildAutoPath(srcPt, se, de, dstPt, srcPort, dstPort, fromEl, toEl) {
  const sh = srcPort === 'e' || srcPort === 'w';
  const dh = dstPort === 'e' || dstPort === 'w';
  let mid;
  if      ( sh &&  dh) mid = midHH(se, de, fromEl, toEl);
  else if (!sh && !dh) mid = midVV(se, de, fromEl, toEl);
  else if ( sh && !dh) mid = midHV(se, de, fromEl, toEl);
  else                 mid = midVH(se, de, fromEl, toEl);
  return dedupPts([srcPt, se, ...mid, de, dstPt]);
}

/**
 * Returns the full ordered list of points for a connection path.
 * When waypoints=[], always auto-routes with obstacle avoidance and port selection.
 * When waypoints are set, respects them but still adds stubs.
 */
function routeConnection(conn, from, to) {
  const tc = centerOf(to), fc = centerOf(from);

  const fromPortFixed = conn.fromPort && conn.fromPort !== 'auto';
  const toPortFixed   = conn.toPort   && conn.toPort   !== 'auto';

  const fromPort = fromPortFixed ? conn.fromPort : getBestPort(from, tc);
  const toPort   = toPortFixed   ? conn.toPort   : getBestPort(to, fc);

  const srcPt = getPortPoint(from, fromPort);
  const dstPt = getPortPoint(to,   toPort);

  // Custom waypoints: sandwich them between stubs
  if (conn.waypoints && conn.waypoints.length > 0) {
    const se = stubPt(srcPt, fromPort), de = stubPt(dstPt, toPort);
    return dedupPts([srcPt, se, ...conn.waypoints, de, dstPt]);
  }

  // Auto-route: try all port pairs only when both are 'auto' (most freedom)
  const tryAll = !fromPortFixed && !toPortFixed;
  return autoRoute(srcPt, fromPort, dstPt, toPort, from, to, tryAll);
}

/** Returns 'h' (horizontal) or 'v' (vertical) for a segment between two points */
function segAxis(p1, p2) {
  return Math.abs(p1.x - p2.x) >= Math.abs(p1.y - p2.y) ? 'h' : 'v';
}

/** Perpendicular distance from point pt to line segment p1→p2 */
function distToSegment(pt, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return Math.hypot(pt.x - p1.x, pt.y - p1.y);
  const t = Math.max(0, Math.min(1, ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(pt.x - p1.x - t * dx, pt.y - p1.y - t * dy);
}

/**
 * Find the nearest draggable segment index (1 .. pts.length-3) to point pt.
 * Returns { segIdx, axis }.
 */
function findNearestSegment(pts, pt) {
  let bestIdx = 1, bestDist = Infinity;
  for (let i = 1; i < pts.length - 2; i++) {
    const d = distToSegment(pt, pts[i], pts[i + 1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return { segIdx: bestIdx, axis: segAxis(pts[bestIdx], pts[bestIdx + 1]) };
}

/** Build the SVG path 'd' string from a list of orthogonal points */
function buildPathString(pts) {
  if (!pts || pts.length < 2) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${rnd(p.x)} ${rnd(p.y)}`).join(' ');
}
function rnd(n) { return Math.round(n * 10) / 10; }

// ============================================================
// ---- CANVAS EVENTS ----
// ============================================================

function setupCanvasEvents() {
  const svg = document.getElementById('canvas');
  svg.addEventListener('mousedown', onCanvasMouseDown);
  window.addEventListener('mousemove', onCanvasMouseMove);
  window.addEventListener('mouseup', onCanvasMouseUp);
  svg.addEventListener('dblclick', onCanvasDblClick);
  svg.addEventListener('contextmenu', e => { e.preventDefault(); if (!state._rightPanMoved) showContextMenu(e); });
  document.getElementById('canvas-container').addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('click', hideContextMenu);
}

function onCanvasMouseDown(e) {
  // ---- Right-click → pan camera ----
  if (e.button === 2) {
    e.preventDefault();
    state.rightPanning = true; state._rightPanMoved = false;
    state.panStart = clientCoords(e); state.panStartX = state.panX; state.panStartY = state.panY;
    document.getElementById('canvas-container').style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  const target = e.target;

  // ---- Endpoint handle drag ----
  if (target.classList.contains('endpoint-handle')) {
    e.stopPropagation();
    const connId = target.dataset.connid;
    const which  = target.dataset.which; // 'from' or 'to'
    pushHistory();
    state.draggingEndpoint = { connId, which };
    return;
  }

  // ---- Segment drag handle ----
  if (target.classList.contains('seg-handle')) {
    e.stopPropagation();
    const connId = target.dataset.connid;
    const segIdx = parseInt(target.dataset.segidx, 10);
    const conn   = state.connections.find(c => c.id === connId);
    const from   = state.elements.find(el => el.id === conn.from);
    const to     = state.elements.find(el => el.id === conn.to);
    if (!conn || !from || !to) return;

    // Initialize interior waypoints from auto-route (excluding stubs and port points)
    // Full path: [srcPt, srcExit, ...wps, dstExit, dstPt]  → store only wps = pts[2..-3]
    if (!conn.waypoints || conn.waypoints.length === 0) {
      const pts = routeConnection(conn, from, to);
      conn.waypoints = pts.slice(2, pts.length - 2).map(p => ({ x: p.x, y: p.y }));
    }

    const pts  = routeConnection(conn, from, to);
    const axis = segAxis(pts[segIdx], pts[segIdx + 1]);
    pushHistory();
    state.draggingSegment = { connId, segIdx, axis, origWaypoints: JSON.parse(JSON.stringify(conn.waypoints)) };
    return;
  }

  // ---- Port click → start connection ----
  if (target.classList.contains('connect-port')) {
    e.stopPropagation();
    state.connecting = { fromId: target.dataset.elid, fromPort: target.dataset.port };
    return;
  }

  // ---- Connect tool on element ----
  if (state.tool === 'connect') {
    const eg = target.closest('.uml-element');
    if (eg) { state.connecting = { fromId: eg.dataset.id, fromPort: 'auto' }; e.stopPropagation(); return; }
  }

  // ---- Connection click ----
  const connLine = target.closest('.connection-line');
  if (connLine && state.tool === 'select') {
    e.stopPropagation();
    const cid = connLine.dataset.id;
    const conn = state.connections.find(c => c.id === cid);
    const from = conn && state.elements.find(el => el.id === conn.from);
    const to   = conn && state.elements.find(el => el.id === conn.to);
    state.selected = ['conn_' + cid];
    renderConnections(); showConnectionProperties(cid);
    // Setup pending segment drag — activated after 5px movement so a plain click still works
    if (conn && from && to) {
      const coords = svgCoords(e);
      const pts = routeConnection(conn, from, to);
      if (pts.length >= 4) {
        const { segIdx, axis } = findNearestSegment(pts, coords);
        state.pendingSegDrag = { connId: cid, segIdx, axis, startX: coords.x, startY: coords.y };
      }
    }
    return;
  }

  // ---- Element select / drag ----
  const elemGroup = target.closest('.uml-element');
  if (elemGroup && state.tool === 'select') {
    e.stopPropagation();
    const id = elemGroup.dataset.id;
    if (!e.shiftKey) {
      if (!state.selected.includes(id)) { state.selected = [id]; renderConnections(); showProperties(); }
    } else {
      state.selected = state.selected.includes(id) ? state.selected.filter(s => s !== id) : [...state.selected, id];
      renderConnections(); showProperties();
    }
    renderSelection();
    const coords = svgCoords(e);
    state.dragging = {
      ids: [...state.selected],
      startX: coords.x, startY: coords.y,
      origPositions: state.selected.filter(s => !s.startsWith('conn_')).map(sid => {
        const el = state.elements.find(el => el.id === sid);
        return el ? { id: sid, x: el.x, y: el.y } : null;
      }).filter(Boolean),
    };
    pushHistory(); return;
  }

  // ---- Resize handle ----
  if (target.classList.contains('resize-handle')) {
    e.stopPropagation();
    const id = target.dataset.id;
    const el = state.elements.find(e => e.id === id); if (!el) return;
    const coords = svgCoords(e);
    state.resizing = { id, startX: coords.x, startY: coords.y, origW: el.w, origH: el.h };
    pushHistory(); return;
  }

  // ---- Pan tool ----
  if (state.tool === 'pan') {
    state.panning = true;
    state.panStart = clientCoords(e); state.panStartX = state.panX; state.panStartY = state.panY;
    document.getElementById('canvas-container').style.cursor = 'grabbing'; return;
  }

  // ---- Shape drawing ----
  if (state.tool === 'shape') {
    const coords = svgCoords(e);
    state.drawing = { x: coords.x, y: coords.y, x2: coords.x, y2: coords.y }; return;
  }

  // ---- Text tool ----
  if (state.tool === 'text') { createTextElement(svgCoords(e)); return; }

  // ---- Deselect + selection box ----
  if (state.tool === 'select') {
    state.selected = []; renderSelection(); renderConnections(); showProperties();
    const coords = svgCoords(e);
    state.selectionBox = { x: coords.x, y: coords.y, x2: coords.x, y2: coords.y };
  }
}

function onCanvasMouseMove(e) {
  const coords = svgCoords(e);
  const client  = clientCoords(e);

  // ---- Right-click pan ----
  if (state.rightPanning) {
    const dx = client.x - state.panStart.x, dy = client.y - state.panStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state._rightPanMoved = true;
    state.panX = state.panStartX + dx; state.panY = state.panStartY + dy;
    applyTransform(); return;
  }

  if (state.panning) {
    state.panX = state.panStartX + (client.x - state.panStart.x);
    state.panY = state.panStartY + (client.y - state.panStart.y);
    applyTransform(); return;
  }

  if (state.dragging) {
    const dx = coords.x - state.dragging.startX, dy = coords.y - state.dragging.startY;
    state.dragging.origPositions.forEach(op => {
      const el = state.elements.find(e => e.id === op.id); if (!el) return;
      el.x = op.x + dx; el.y = op.y + dy;
      if (state.showGrid) { el.x = Math.round(el.x / 10) * 10; el.y = Math.round(el.y / 10) * 10; }
    });
    renderElements(); renderConnections(); renderSelection(); return;
  }

  if (state.resizing) {
    const r = state.resizing, el = state.elements.find(e => e.id === r.id); if (!el) return;
    el.w = Math.max(60, r.origW + (coords.x - r.startX)); el.h = Math.max(40, r.origH + (coords.y - r.startY));
    renderElements(); renderConnections(); renderSelection(); return;
  }

  // ---- Pending segment drag activation (5px threshold) ----
  if (state.pendingSegDrag) {
    const { startX, startY, connId, segIdx, axis } = state.pendingSegDrag;
    if (Math.hypot(coords.x - startX, coords.y - startY) * state.zoom > 5) {
      const conn = state.connections.find(c => c.id === connId);
      const from = conn && state.elements.find(el => el.id === conn.from);
      const to   = conn && state.elements.find(el => el.id === conn.to);
      if (conn && from && to) {
        if (!conn.waypoints || conn.waypoints.length === 0) {
          const pts = routeConnection(conn, from, to);
          conn.waypoints = pts.slice(2, pts.length - 2).map(p => ({ x: p.x, y: p.y }));
        }
        pushHistory();
        state.draggingSegment = { connId, segIdx, axis };
      }
      state.pendingSegDrag = null;
      // Fall through to draggingSegment handler below
    } else {
      return; // Haven't moved enough yet — wait
    }
  }

  // ---- Segment drag (axis-constrained) ----
  if (state.draggingSegment) {
    const { connId, segIdx, axis } = state.draggingSegment;
    const conn = state.connections.find(c => c.id === connId);
    const from = state.elements.find(e => e.id === conn.from);
    const to   = state.elements.find(e => e.id === conn.to);
    if (!conn || !from || !to) return;

    // Full path layout: [srcPt(0), srcExit(1), wps[0](2), ..., wps[k-1](k+1), dstExit(k+2), dstPt(k+3)]
    // Draggable segments: 1..k+2 (NOT 0 = srcPt→srcExit, NOT k+3 = dstExit→dstPt)
    // wps[j] corresponds to pts[j+2], so pts[i] → wps[i-2] (if 2 <= i <= k+1)
    const wps = conn.waypoints || [];
    const k   = wps.length;

    // Helper: is pts[i] an interior waypoint (in wps)?
    const isWp = (i) => i >= 2 && i <= k + 1;
    // wps index for pts[i]
    const wpIdx = (i) => i - 2;

    if (axis === 'h') {
      const newY = coords.y;
      // Update p1 (pts[segIdx]) if it's a waypoint
      if (isWp(segIdx))     wps[wpIdx(segIdx)].y     = newY;
      // Update p2 (pts[segIdx+1]) if it's a waypoint
      if (isWp(segIdx + 1)) wps[wpIdx(segIdx + 1)].y = newY;
    } else {
      const newX = coords.x;
      if (isWp(segIdx))     wps[wpIdx(segIdx)].x     = newX;
      if (isWp(segIdx + 1)) wps[wpIdx(segIdx + 1)].x = newX;
    }

    renderConnections(); return;
  }

  // ---- Endpoint drag ----
  if (state.draggingEndpoint) {
    state.draggingEndpoint.curX = coords.x;
    state.draggingEndpoint.curY = coords.y;
    renderConnections(); return; // shows snapping preview
  }

  if (state.connecting) { drawTempLine(coords); return; }
  if (state.drawing)    { state.drawing.x2 = coords.x; state.drawing.y2 = coords.y; drawTempShape(); return; }
  if (state.selectionBox) {
    state.selectionBox.x2 = coords.x; state.selectionBox.y2 = coords.y; drawSelectionBox();
  }
}

function onCanvasMouseUp(e) {
  if (e.button === 2 && state.rightPanning) {
    state.rightPanning = false;
    document.getElementById('canvas-container').style.cursor = state.tool === 'pan' ? 'grab' : 'default';
    return;
  }

  if (state.panning)   { state.panning = false; document.getElementById('canvas-container').style.cursor = 'grab'; return; }
  if (state.dragging)  { state.dragging = null; persistCurrentDiagram(); return; }
  if (state.resizing)  { state.resizing = null; persistCurrentDiagram(); showProperties(); return; }

  // ---- Pending seg drag cancelled (no movement) ----
  if (state.pendingSegDrag) { state.pendingSegDrag = null; return; }

  // ---- Segment drag end ----
  if (state.draggingSegment) { state.draggingSegment = null; persistCurrentDiagram(); return; }

  // ---- Endpoint drag end ----
  if (state.draggingEndpoint) {
    const { connId, which, curX, curY } = state.draggingEndpoint;
    state.draggingEndpoint = null;
    const conn = state.connections.find(c => c.id === connId);
    if (!conn || curX === undefined) { renderConnections(); return; }

    const targetElId = which === 'from' ? conn.from : conn.to;
    const el = state.elements.find(e => e.id === targetElId);
    if (el) {
      const port = snapToNearestPort(el, { x: curX, y: curY });
      if (which === 'from') conn.fromPort = port;
      else                  conn.toPort   = port;
      conn.waypoints = []; // re-route
    }
    renderConnections(); persistCurrentDiagram(); return;
  }

  // ---- Connection end ----
  if (state.connecting) {
    document.getElementById('temp-layer').innerHTML = '';
    const target = e.target.closest('.uml-element');
    if (target && target.dataset.id !== state.connecting.fromId) {
      pushHistory();
      // Pick best port based on cursor position
      const coords  = svgCoords(e);
      const fromEl  = state.elements.find(el => el.id === state.connecting.fromId);
      const toEl    = state.elements.find(el => el.id === target.dataset.id);
      const toPort  = e.target.classList.contains('connect-port') ? e.target.dataset.port : snapToNearestPort(toEl, coords);
      const fromPort = state.connecting.fromPort !== 'auto' ? state.connecting.fromPort : getBestPort(fromEl, centerOf(toEl));
      state.connections.push({ id: genId(), from: state.connecting.fromId, to: target.dataset.id, fromPort, toPort, type: state.connectorType, label: '', color: '#555555', strokeWidth: 1.5, waypoints: [] });
      renderConnections(); persistCurrentDiagram();
    }
    state.connecting = null; return;
  }

  if (state.drawing) {
    const { x, y, x2, y2 } = state.drawing;
    const w = Math.abs(x2 - x), h = Math.abs(y2 - y);
    if (w > 10 && h > 10) { pushHistory(); createElement(state.shapeTool, Math.min(x, x2), Math.min(y, y2), w, h); }
    state.drawing = null; document.getElementById('temp-layer').innerHTML = ''; return;
  }

  if (state.selectionBox) {
    const { x, y, x2, y2 } = state.selectionBox;
    const minX = Math.min(x,x2), maxX = Math.max(x,x2), minY = Math.min(y,y2), maxY = Math.max(y,y2);
    state.selected = state.elements.filter(el => el.x >= minX && el.x+el.w <= maxX && el.y >= minY && el.y+el.h <= maxY).map(el => el.id);
    state.selectionBox = null; document.getElementById('temp-layer').innerHTML = '';
    renderSelection(); renderConnections(); showProperties();
  }
}

function onCanvasDblClick(e) {
  const connLine = e.target.closest('.connection-line');
  if (connLine) {
    const conn = state.connections.find(c => c.id === connLine.dataset.id);
    if (conn) { pushHistory(); conn.waypoints = []; renderConnections(); persistCurrentDiagram(); }
    return;
  }
  const elemGroup = e.target.closest('.uml-element');
  if (elemGroup) { const el = state.elements.find(el => el.id === elemGroup.dataset.id); if (el) startInlineEdit(el, e); }
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1, client = clientCoords(e), oldZ = state.zoom;
  state.zoom = Math.max(0.1, Math.min(4, state.zoom + delta));
  state.panX = client.x - (client.x - state.panX) * (state.zoom / oldZ);
  state.panY = client.y - (client.y - state.panY) * (state.zoom / oldZ);
  applyTransform(); updateZoomDisplay();
}

function applyTransform() {
  const t = `translate(${state.panX}, ${state.panY}) scale(${state.zoom})`;
  ['connections-layer','elements-layer','temp-layer'].forEach(id => { const g = document.getElementById(id); if (g) g.setAttribute('transform', t); });
  const gp = document.getElementById('grid-pattern');
  if (gp) { gp.setAttribute('x', state.panX % (20*state.zoom)); gp.setAttribute('y', state.panY % (20*state.zoom)); gp.setAttribute('width', 20*state.zoom); gp.setAttribute('height', 20*state.zoom); }
}

function zoom(delta) { state.zoom = Math.max(0.1, Math.min(4, state.zoom + delta)); applyTransform(); updateZoomDisplay(); }
function updateZoomDisplay() { document.getElementById('zoom-display').textContent = Math.round(state.zoom * 100) + '%'; }
function fitView() {
  if (!state.elements.length) return;
  const minX = Math.min(...state.elements.map(e=>e.x)), minY = Math.min(...state.elements.map(e=>e.y));
  const maxX = Math.max(...state.elements.map(e=>e.x+e.w)), maxY = Math.max(...state.elements.map(e=>e.y+e.h));
  const c = document.getElementById('canvas-container'), cw = c.clientWidth, ch = c.clientHeight;
  state.zoom = Math.min(1, Math.min((cw-80)/(maxX-minX), (ch-80)/(maxY-minY)));
  state.panX = (cw-(maxX-minX)*state.zoom)/2 - minX*state.zoom;
  state.panY = (ch-(maxY-minY)*state.zoom)/2 - minY*state.zoom;
  applyTransform(); updateZoomDisplay();
}
function toggleGrid() { state.showGrid = !state.showGrid; document.getElementById('grid-bg').style.display = state.showGrid ? '' : 'none'; }

// ============================================================
// ---- ELEMENT CREATION ----
// ============================================================

function createElement(type, x, y, w, h, extra = {}) {
  const D = {
    rectangle:{fill:'#ffffff',stroke:'#555555',text:'Elemento',rx:0},
    rounded:  {fill:'#ffffff',stroke:'#555555',text:'Elemento',rx:10},
    diamond:  {fill:'#ffffff',stroke:'#555555',text:'Decisão'},
    circle:   {fill:'#ffffff',stroke:'#555555',text:'Estado'},
    actor:    {fill:'#ffffff',stroke:'#555555',text:'Ator'},
    note:     {fill:'#fef9c3',stroke:'#d97706',text:'Nota'},
    cylinder: {fill:'#dbeafe',stroke:'#3b82f6',text:'Database'},
    package:  {fill:'#f3e8ff',stroke:'#9333ea',text:'Pacote'},
    text:     {fill:'none',   stroke:'none',   text:'Texto'},
    class:    {fill:'#ffffff',stroke:'#555555',text:'Classe'},
    interface:{fill:'#ffffff',stroke:'#555555',text:'«interface»\nNome'},
    component:{fill:'#dbeafe',stroke:'#3b82f6',text:'Componente'},
    state:    {fill:'#dcfce7',stroke:'#16a34a',text:'Estado'},
  };
  const def = D[type] || D.rectangle;
  const el = { id: genId(), type, x: Math.round(x), y: Math.round(y), w: Math.round(w||120), h: Math.round(h||60), fill: def.fill, stroke: def.stroke, text: def.text, fontSize: 13, strokeWidth: 1.5, rx: def.rx||0, zIndex: state.elements.length, ...extra };
  state.elements.push(el);
  renderElements(); renderConnections(); state.selected = [el.id]; renderSelection(); showProperties(); persistCurrentDiagram();
  return el;
}
function createTextElement({ x, y }) { pushHistory(); createElement('text', x-60, y-15, 120, 30, { text: 'Texto', fontSize: 14, fill: 'none', stroke: 'none' }); }

function insertTemplate(type) {
  const cx = (document.getElementById('canvas-container').clientWidth/2 - state.panX) / state.zoom;
  const cy = (document.getElementById('canvas-container').clientHeight/2 - state.panY) / state.zoom;
  pushHistory();
  const T = { class: () => createElement('class',cx-80,cy-60,160,120,{text:'NomeClasse',classBody:'- atributo: Tipo\n+ metodo(): void',fill:'#ffffff',stroke:'#555'}),
    interface: () => createElement('interface',cx-80,cy-50,160,100,{text:'«interface»\nINome',classBody:'+ metodo(): void',fill:'#f0fdf4',stroke:'#16a34a'}),
    usecase:   () => createElement('circle',cx-70,cy-35,140,70,{text:'Caso de Uso',fill:'#eff6ff',stroke:'#3b82f6'}),
    sequence:  () => { createElement('actor',cx-120,cy-30,60,80,{text:'Ator'}); createElement('rectangle',cx,cy-30,100,40,{text:':Objeto',fill:'#eff6ff',stroke:'#3b82f6'}); },
    component: () => createElement('component',cx-70,cy-40,140,80,{text:'«component»\nNome',fill:'#eff6ff',stroke:'#3b82f6'}),
    state:     () => createElement('rounded',cx-60,cy-25,120,50,{text:'Estado',fill:'#dcfce7',stroke:'#16a34a',rx:25}),
  };
  if (T[type]) T[type](); persistCurrentDiagram();
}

// ============================================================
// ---- RENDERING ----
// ============================================================

function renderAll() { renderElements(); renderConnections(); renderSelection(); applyTransform(); }

function renderElements() {
  const layer = document.getElementById('elements-layer'); layer.innerHTML = '';
  [...state.elements].sort((a,b) => (a.zIndex||0)-(b.zIndex||0)).forEach(el => layer.appendChild(createElementSVG(el)));
}

function createElementSVG(el) {
  const g = svgEl('g', { class: 'uml-element', 'data-id': el.id });
  const R = { rectangle:renderRect, rounded:renderRect, class:renderRect, interface:renderRect, component:renderRect, state:renderRect, diamond:renderDiamond, circle:renderEllipse, actor:renderActor, note:renderNote, cylinder:renderCylinder, package:renderPackage, text:renderTextEl };
  (R[el.type] || renderRect)(g, el);
  addPorts(g, el);
  return g;
}

function renderRect(g, el) {
  const isClass = el.type === 'class' || el.type === 'interface';
  const rx = el.rx || 0;
  g.appendChild(svgEl('rect', { x:el.x, y:el.y, width:el.w, height:el.h, rx, ry:rx, fill:el.fill, stroke:el.stroke, 'stroke-width':el.strokeWidth||1.5, class:'element-body' }));
  if (isClass && el.classBody) {
    const hh = 30;
    g.appendChild(svgEl('rect', { x:el.x, y:el.y, width:el.w, height:hh, fill:el.stroke||'#555', rx, ry:rx }));
    g.appendChild(svgEl('rect', { x:el.x, y:el.y+rx, width:el.w, height:hh-rx, fill:el.stroke||'#555' }));
    addText(g, el.text, el.x+el.w/2, el.y+hh/2+1, { fill:'#fff', 'font-weight':'bold', 'font-size':el.fontSize||13, 'text-anchor':'middle', 'dominant-baseline':'middle' });
    g.appendChild(svgEl('line', { x1:el.x, y1:el.y+hh, x2:el.x+el.w, y2:el.y+hh, stroke:el.stroke, 'stroke-width':1 }));
    (el.classBody||'').split('\n').forEach((line,i) => addText(g, line, el.x+8, el.y+hh+16+i*16, { fill:el.stroke||'#333', 'font-size':11, 'text-anchor':'start', 'dominant-baseline':'middle' }));
  } else {
    addWrappedText(g, el.text, el.x, el.y, el.w, el.h, { fill:'#333', 'font-size':el.fontSize||13 });
  }
}
function renderDiamond(g, el) {
  const cx=el.x+el.w/2, cy=el.y+el.h/2;
  g.appendChild(svgEl('polygon', { points:`${cx},${el.y} ${el.x+el.w},${cy} ${cx},${el.y+el.h} ${el.x},${cy}`, fill:el.fill, stroke:el.stroke, 'stroke-width':el.strokeWidth||1.5, class:'element-body' }));
  addWrappedText(g, el.text, el.x, el.y, el.w, el.h, { fill:'#333', 'font-size':el.fontSize||13 });
}
function renderEllipse(g, el) {
  const cx=el.x+el.w/2, cy=el.y+el.h/2;
  g.appendChild(svgEl('ellipse', { cx, cy, rx:el.w/2, ry:el.h/2, fill:el.fill, stroke:el.stroke, 'stroke-width':el.strokeWidth||1.5, class:'element-body' }));
  addWrappedText(g, el.text, el.x, el.y, el.w, el.h, { fill:'#333', 'font-size':el.fontSize||13 });
}
function renderActor(g, el) {
  const cx=el.x+el.w/2, r=Math.min(el.w*0.2,12), headY=el.y+r+4, bodyY=headY+r, legY=el.y+el.h-16;
  g.appendChild(svgEl('circle', { cx, cy:headY, r, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('line', { x1:cx, y1:bodyY, x2:cx, y2:legY, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('line', { x1:cx-el.w*0.25, y1:bodyY+8, x2:cx+el.w*0.25, y2:bodyY+8, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('line', { x1:cx, y1:legY, x2:cx-el.w*0.2, y2:el.y+el.h, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('line', { x1:cx, y1:legY, x2:cx+el.w*0.2, y2:el.y+el.h, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('rect', { x:el.x, y:el.y, width:el.w, height:el.h, fill:'transparent', stroke:'none' }));
  addText(g, el.text, cx, el.y+el.h+2, { fill:'#333', 'font-size':el.fontSize||12, 'text-anchor':'middle', 'dominant-baseline':'hanging' });
}
function renderNote(g, el) {
  const fold=14;
  g.appendChild(svgEl('polygon', { points:`${el.x},${el.y} ${el.x+el.w-fold},${el.y} ${el.x+el.w},${el.y+fold} ${el.x+el.w},${el.y+el.h} ${el.x},${el.y+el.h}`, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5, class:'element-body' }));
  g.appendChild(svgEl('polyline', { points:`${el.x+el.w-fold},${el.y} ${el.x+el.w-fold},${el.y+fold} ${el.x+el.w},${el.y+fold}`, fill:'none', stroke:el.stroke, 'stroke-width':1 }));
  addWrappedText(g, el.text, el.x+4, el.y+4, el.w-18, el.h-8, { fill:'#555', 'font-size':el.fontSize||12, 'text-anchor':'start', 'dominant-baseline':'hanging' }, true);
}
function renderCylinder(g, el) {
  const ry=el.h*0.15, rx=el.w/2;
  g.appendChild(svgEl('rect',    { x:el.x, y:el.y+ry, width:el.w, height:el.h-ry*2, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('ellipse', { cx:el.x+rx, cy:el.y+ry, rx, ry, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('ellipse', { cx:el.x+rx, cy:el.y+el.h-ry, rx, ry, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5 }));
  g.appendChild(svgEl('rect',    { x:el.x, y:el.y, width:el.w, height:el.h, fill:'transparent', stroke:'none', class:'element-body' }));
  addWrappedText(g, el.text, el.x, el.y, el.w, el.h, { fill:'#333', 'font-size':el.fontSize||12 });
}
function renderPackage(g, el) {
  const tabH=18, tabW=Math.min(el.w*0.4,70);
  g.appendChild(svgEl('rect', { x:el.x, y:el.y+tabH, width:el.w, height:el.h-tabH, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5, class:'element-body' }));
  g.appendChild(svgEl('rect', { x:el.x, y:el.y, width:tabW, height:tabH, fill:el.fill, stroke:el.stroke, 'stroke-width':1.5 }));
  addText(g, el.text, el.x+el.w/2, el.y+el.h/2+tabH/2, { fill:'#333', 'font-size':el.fontSize||13, 'text-anchor':'middle', 'dominant-baseline':'middle' });
}
function renderTextEl(g, el) {
  g.appendChild(svgEl('rect', { x:el.x, y:el.y, width:el.w, height:el.h, fill:'transparent', stroke:'none', class:'element-body' }));
  addWrappedText(g, el.text, el.x, el.y, el.w, el.h, { fill:el.stroke !== 'none' ? el.stroke : '#333', 'font-size':el.fontSize||14 });
}

function addText(g, text, x, y, attrs) { const t = svgEl('text', { x, y, ...attrs }); t.textContent = text; g.appendChild(t); }
function addWrappedText(g, text, x, y, w, h, attrs, topAlign=false) {
  const lines = (text||'').split('\n'), fs = parseFloat(attrs['font-size']||13), lh = fs*1.3;
  const startY = topAlign ? y+fs : y+h/2 - lines.length*lh/2 + fs;
  lines.forEach((line,i) => {
    const t = svgEl('text', { x: attrs['text-anchor']==='start'?x:x+w/2, y:startY+i*lh, 'text-anchor':attrs['text-anchor']||'middle', 'font-size':fs, fill:attrs.fill||'#333', 'font-family':'inherit' });
    t.textContent = line; g.appendChild(t);
  });
}
function addPorts(g, el) {
  [['n',el.x+el.w/2,el.y],['s',el.x+el.w/2,el.y+el.h],['e',el.x+el.w,el.y+el.h/2],['w',el.x,el.y+el.h/2]].forEach(([id,cx,cy]) => {
    g.appendChild(svgEl('circle', { cx, cy, r:5, class:'connect-port', 'data-elid':el.id, 'data-port':id }));
  });
}

// ============================================================
// ---- CONNECTION RENDERING ----
// ============================================================

function renderConnections() {
  const layer = document.getElementById('connections-layer'); layer.innerHTML = '';

  state.connections.forEach(conn => {
    const from = state.elements.find(e => e.id === conn.from);
    const to   = state.elements.find(e => e.id === conn.to);
    if (!from || !to) return;

    const pts        = routeConnection(conn, from, to);
    const pathD      = buildPathString(pts);
    const isSelected = state.selected.includes('conn_' + conn.id);
    const { strokeDash, markerEnd, markerStart } = getConnectorStyle(conn.type);
    const color      = conn.color || '#555555';
    const sw         = conn.strokeWidth || 1.5;

    const g = svgEl('g', { class: 'connection-line', 'data-id': conn.id });
    if (isSelected) g.classList.add('conn-selected');

    // Wide invisible hit area (easy to grab anywhere)
    g.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(18, sw + 14) }));

    // Hover highlight — always present, CSS fades it in on hover
    g.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: '#cba6f7', 'stroke-width': sw + 4, 'pointer-events': 'none', 'stroke-dasharray': 'none', class: 'conn-hover-highlight' }));

    // Selection glow (only when selected)
    if (isSelected) {
      g.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: '#cba6f7', 'stroke-width': sw + 4, opacity: '0.4', 'pointer-events': 'none', 'stroke-dasharray': 'none' }));
    }

    // Actual visible path
    g.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-dasharray': strokeDash || 'none', 'marker-end': markerEnd || '', 'marker-start': markerStart || '', 'pointer-events': 'none' }));

    // Label
    if (conn.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      const lbl = svgEl('text', { x: mid.x, y: mid.y - 7, class: 'connection-label', 'text-anchor': 'middle' });
      lbl.textContent = conn.label; g.appendChild(lbl);
    }

    // Mid-point indicator dot — always present, CSS shows on hover
    const midPt = pts[Math.floor(pts.length / 2)];
    g.appendChild(svgEl('circle', { cx: midPt.x, cy: midPt.y, r: 4, fill: '#cba6f7', stroke: 'white', 'stroke-width': 1.5, class: 'mid-dot' }));

    // Handles for all connections (CSS controls opacity via hover / conn-selected)
    renderConnectionHandles(g, conn, pts, from, to, isSelected);

    layer.appendChild(g);
  });

  // Render port snapping preview during endpoint drag
  if (state.draggingEndpoint && state.draggingEndpoint.curX !== undefined) {
    renderEndpointSnapPreview();
  }
}

/**
 * Renders handles for a connection (always called for all connections).
 * CSS class controls visibility: opacity 0 by default, shown on hover (.connection-line:hover)
 * and fully shown when selected (.conn-selected).
 * Port rings are only added when isSelected === true.
 */
function renderConnectionHandles(g, conn, pts, from, to, isSelected) {
  const src = pts[0], dst = pts[pts.length - 1];

  // ---- Endpoint handles (diamond shape) ----
  // opacity="0" — CSS overrides via .connection-line:hover and .conn-selected
  const makeEndpointHandle = (pt, which) => {
    const size = 10; // larger for easier grabbing
    g.appendChild(svgEl('polygon', {
      points: `${pt.x},${pt.y-size} ${pt.x+size},${pt.y} ${pt.x},${pt.y+size} ${pt.x-size},${pt.y}`,
      fill: '#89b4fa', stroke: 'white', 'stroke-width': 1.5,
      opacity: '0',
      class: 'endpoint-handle',
      'data-connid': conn.id,
      'data-which': which,
      cursor: 'crosshair',
    }));
  };
  makeEndpointHandle(src, 'from');
  makeEndpointHandle(dst, 'to');

  // Port rings / indicators — only when selected
  if (isSelected) {
    const isDraggingThis = state.draggingEndpoint && state.draggingEndpoint.connId === conn.id;
    if (isDraggingThis) {
      const { which, curX, curY } = state.draggingEndpoint;
      const targetEl = which === 'from' ? from : to;
      const hoveredPort = curX !== undefined ? snapToNearestPort(targetEl, { x: curX, y: curY }) : null;
      getAllPorts(targetEl).forEach(p => {
        const isHov = p.id === hoveredPort;
        g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: isHov ? 9 : 6, fill: isHov ? '#89b4fa' : 'none', stroke: '#89b4fa', 'stroke-width': 2, opacity: '0.9', 'pointer-events': 'none' }));
      });
    } else {
      [{ el: from, port: conn.fromPort }, { el: to, port: conn.toPort }].forEach(({ el, port }) => {
        if (port && port !== 'auto') {
          const pt = getPortPoint(el, port);
          g.appendChild(svgEl('circle', { cx: pt.x, cy: pt.y, r: 5, fill: '#89b4fa', stroke: 'white', 'stroke-width': 1.5, opacity: '0.7', 'pointer-events': 'none' }));
        }
      });
    }
  }

  // ---- Segment drag handles ----
  // Full path: [srcPt(0), srcExit(1), wps..., dstExit(n-2), dstPt(n-1)]
  // Draggable range: segments 1 .. n-3 (skip stubs at either end).
  // opacity="0" — CSS shows via hover / conn-selected.
  for (let i = 1; i < pts.length - 2; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const axis   = segAxis(p1, p2);
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segLen < 12) continue; // skip degenerate

    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    let barW, barH;
    if (axis === 'h') { barW = Math.min(48, segLen * 0.55); barH = 10; }
    else              { barW = 10; barH = Math.min(48, segLen * 0.55); }

    g.appendChild(svgEl('rect', {
      x: mx - barW / 2, y: my - barH / 2,
      width: barW, height: barH,
      rx: 4, ry: 4,
      fill: '#cba6f7', stroke: 'white', 'stroke-width': 1.5,
      opacity: '0',
      class: 'seg-handle',
      'data-connid': conn.id,
      'data-segidx': i,
      cursor: axis === 'h' ? 'ns-resize' : 'ew-resize',
    }));
  }
}

/** Renders a preview circle near the cursor during endpoint drag to show which port will be snapped */
function renderEndpointSnapPreview() {
  const { connId, which, curX, curY } = state.draggingEndpoint;
  const conn = state.connections.find(c => c.id === connId); if (!conn) return;
  const targetElId = which === 'from' ? conn.from : conn.to;
  const el = state.elements.find(e => e.id === targetElId); if (!el) return;

  const layer = document.getElementById('connections-layer');
  const snapPort = snapToNearestPort(el, { x: curX, y: curY });
  const snapPt   = getPortPoint(el, snapPort);

  const preview = svgEl('g', {});
  preview.appendChild(svgEl('line', { x1: curX, y1: curY, x2: snapPt.x, y2: snapPt.y, stroke: '#89b4fa', 'stroke-width': 1.5, 'stroke-dasharray': '4 2', 'pointer-events': 'none' }));
  preview.appendChild(svgEl('circle', { cx: curX, cy: curY, r: 5, fill: '#89b4fa', stroke: 'white', 'stroke-width': 1.5, 'pointer-events': 'none' }));
  layer.appendChild(preview);
}

function getConnectorStyle(type) {
  const S = {
    'arrow':          { markerEnd: 'url(#arrow)',                    strokeDash: 'none' },
    'dashed-arrow':   { markerEnd: 'url(#arrow)',                    strokeDash: '7 4' },
    'hollow-arrow':   { markerEnd: 'url(#hollow-arrow)',             strokeDash: 'none' },
    'dashed-hollow':  { markerEnd: 'url(#hollow-arrow)',             strokeDash: '7 4' },
    'diamond-line':   { markerStart: 'url(#diamond-marker)',         strokeDash: 'none' },
    'filled-diamond': { markerStart: 'url(#filled-diamond-marker)', strokeDash: 'none' },
    'line':           { strokeDash: 'none' },
    'dashed':         { strokeDash: '7 4' },
  };
  return S[type] || S['arrow'];
}

function centerOf(el) { return { x: el.x + el.w/2, y: el.y + el.h/2 }; }

// ============================================================
// ---- SELECTION ----
// ============================================================

function renderSelection() {
  document.querySelectorAll('.selected-outline, .resize-handle').forEach(e => e.remove());
  state.selected.forEach(id => {
    if (id.startsWith('conn_')) return;
    const el = state.elements.find(e => e.id === id); if (!el) return;
    const g  = document.querySelector(`[data-id="${id}"]`); if (!g) return;
    const pad = 4;
    g.appendChild(svgEl('rect', { x:el.x-pad, y:el.y-pad, width:el.w+pad*2, height:el.h+pad*2, class:'selected-outline', rx:2, ry:2 }));
    g.appendChild(svgEl('rect', { x:el.x+el.w-5, y:el.y+el.h-5, width:10, height:10, class:'resize-handle', rx:2, 'data-id':id }));
  });
}

// ---- Inline edit ----
function startInlineEdit(el, e) {
  const svg = document.getElementById('canvas'), rect = svg.getBoundingClientRect();
  const ta = document.createElement('textarea');
  ta.value = el.text;
  ta.style.cssText = `position:fixed;left:${el.x*state.zoom+state.panX+rect.left}px;top:${el.y*state.zoom+state.panY+rect.top}px;width:${el.w*state.zoom}px;height:${el.h*state.zoom}px;font-size:${(el.fontSize||13)*state.zoom}px;background:rgba(255,255,255,0.95);border:2px solid #cba6f7;border-radius:4px;padding:4px;resize:none;z-index:200;font-family:inherit;color:#333;text-align:center;outline:none;`;
  document.body.appendChild(ta); ta.focus(); ta.select();
  const finish = () => { pushHistory(); el.text = ta.value; ta.remove(); renderElements(); renderConnections(); persistCurrentDiagram(); showProperties(); };
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') ta.remove(); });
}

// ---- Temp drawing ----
function drawTempLine(coords) {
  const from = state.elements.find(e => e.id === state.connecting.fromId); if (!from) return;
  const fc = centerOf(from), temp = document.getElementById('temp-layer'); temp.innerHTML = '';
  temp.appendChild(svgEl('line', { x1:fc.x, y1:fc.y, x2:coords.x, y2:coords.y, class:'connecting-line' }));
}
function drawTempShape() {
  const { x, y, x2, y2 } = state.drawing, temp = document.getElementById('temp-layer'); temp.innerHTML = '';
  temp.appendChild(svgEl('rect', { x:Math.min(x,x2), y:Math.min(y,y2), width:Math.abs(x2-x), height:Math.abs(y2-y), fill:'rgba(203,166,247,0.1)', stroke:'#cba6f7', 'stroke-width':1, 'stroke-dasharray':'4 2' }));
}
function drawSelectionBox() {
  const { x, y, x2, y2 } = state.selectionBox, temp = document.getElementById('temp-layer'); temp.innerHTML = '';
  temp.appendChild(svgEl('rect', { x:Math.min(x,x2), y:Math.min(y,y2), width:Math.abs(x2-x), height:Math.abs(y2-y), fill:'rgba(203,166,247,0.1)', stroke:'#cba6f7', 'stroke-width':1, 'stroke-dasharray':'4 2' }));
}

// ============================================================
// ---- PROPERTIES PANEL ----
// ============================================================

function showProperties() {
  const panel = document.getElementById('properties-panel');
  if (state.selected.length === 0) { panel.innerHTML = '<div class="no-selection">Selecione um elemento para editar suas propriedades</div>'; return; }
  if (state.selected.length > 1)   { panel.innerHTML = `<div class="no-selection">${state.selected.length} elementos selecionados</div><button class="prop-btn danger" onclick="deleteSelected()">Excluir selecionados</button>`; return; }
  const id = state.selected[0];
  if (id.startsWith('conn_')) { showConnectionProperties(id.replace('conn_', '')); return; }
  const el = state.elements.find(e => e.id === id); if (!el) return;
  const colors = ['#ffffff','#f8f9fa','#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe','#ffedd5','#333333','#1d4ed8','#16a34a','#d97706','#dc2626','#9333ea'];
  panel.innerHTML = `
    <div class="prop-group"><label class="prop-label">Texto</label><textarea class="prop-textarea" id="prop-text" rows="3">${escHtml(el.text)}</textarea></div>
    ${(el.type==='class'||el.type==='interface')?`<div class="prop-group"><label class="prop-label">Corpo</label><textarea class="prop-textarea" id="prop-body" rows="4">${escHtml(el.classBody||'')}</textarea></div>`:''}
    <div class="prop-group"><label class="prop-label">Tamanho da fonte</label><input type="number" class="prop-input" id="prop-fontsize" value="${el.fontSize||13}" min="8" max="48"/></div>
    <div class="prop-group"><label class="prop-label">Preenchimento</label>
      <div class="color-row">${colors.map(c=>`<div class="color-swatch${el.fill===c?' active':''}" style="background:${c}" onclick="setPropColor('fill','${c}')"></div>`).join('')}</div>
      <input type="color" class="prop-color-input" value="${el.fill!=='none'?el.fill:'#ffffff'}" onchange="setPropColor('fill',this.value)" style="margin-top:4px"/>
    </div>
    <div class="prop-group"><label class="prop-label">Contorno</label>
      <div class="color-row">${colors.map(c=>`<div class="color-swatch${el.stroke===c?' active':''}" style="background:${c}" onclick="setPropColor('stroke','${c}')"></div>`).join('')}</div>
      <input type="color" class="prop-color-input" value="${el.stroke!=='none'?el.stroke:'#555555'}" onchange="setPropColor('stroke',this.value)" style="margin-top:4px"/>
    </div>
    <div class="prop-group"><label class="prop-label">Espessura do contorno</label><input type="range" class="prop-input" id="prop-sw" min="0.5" max="6" step="0.5" value="${el.strokeWidth||1.5}" style="padding:0"/></div>
    <div class="prop-group"><label class="prop-label">Posição e Tamanho</label>
      <div class="prop-row"><input type="number" class="prop-input" id="prop-x" value="${Math.round(el.x)}" placeholder="X"/><input type="number" class="prop-input" id="prop-y" value="${Math.round(el.y)}" placeholder="Y"/></div>
      <div class="prop-row" style="margin-top:4px"><input type="number" class="prop-input" id="prop-w" value="${Math.round(el.w)}" placeholder="W"/><input type="number" class="prop-input" id="prop-h" value="${Math.round(el.h)}" placeholder="H"/></div>
    </div>
    <button class="prop-btn danger" onclick="deleteSelected()">Excluir</button>`;
  const bind = (domId, prop, isNum=false) => {
    const inp = document.getElementById(domId); if (!inp) return;
    inp.addEventListener('input', () => { el[prop] = isNum ? parseFloat(inp.value) : inp.value; renderElements(); renderConnections(); renderSelection(); persistCurrentDiagram(); });
  };
  bind('prop-text','text'); bind('prop-body','classBody'); bind('prop-fontsize','fontSize',true); bind('prop-sw','strokeWidth',true);
  bind('prop-x','x',true); bind('prop-y','y',true); bind('prop-w','w',true); bind('prop-h','h',true);
}

function showConnectionProperties(cid) {
  const conn = state.connections.find(c => c.id === cid); if (!conn) return;
  const panel = document.getElementById('properties-panel');
  const portOpts = (sel) => ['auto','n','s','e','w'].map(p => `<option value="${p}" ${sel===p?'selected':''}>${({auto:'Automático',n:'Topo (N)',s:'Base (S)',e:'Direita (E)',w:'Esquerda (W)'})[p]}</option>`).join('');
  panel.innerHTML = `
    <div class="prop-group"><label class="prop-label">Rótulo</label><input type="text" class="prop-input" id="conn-label" value="${escHtml(conn.label||'')}"/></div>
    <div class="prop-group"><label class="prop-label">Tipo</label>
      <select class="prop-select" id="conn-type">
        <option value="arrow"          ${conn.type==='arrow'?'selected':''}>→ Associação</option>
        <option value="dashed-arrow"   ${conn.type==='dashed-arrow'?'selected':''}>--→ Dependência</option>
        <option value="hollow-arrow"   ${conn.type==='hollow-arrow'?'selected':''}>→ Herança</option>
        <option value="dashed-hollow"  ${conn.type==='dashed-hollow'?'selected':''}>--▷ Realização</option>
        <option value="diamond-line"   ${conn.type==='diamond-line'?'selected':''}>◇— Agregação</option>
        <option value="filled-diamond" ${conn.type==='filled-diamond'?'selected':''}>◆— Composição</option>
        <option value="line"           ${conn.type==='line'?'selected':''}>— Linha</option>
        <option value="dashed"         ${conn.type==='dashed'?'selected':''}>- - Tracejada</option>
      </select>
    </div>
    <div class="prop-group"><label class="prop-label">Porta de saída (origem)</label><select class="prop-select" id="conn-fromport">${portOpts(conn.fromPort||'auto')}</select></div>
    <div class="prop-group"><label class="prop-label">Porta de entrada (destino)</label><select class="prop-select" id="conn-toport">${portOpts(conn.toPort||'auto')}</select></div>
    <div class="prop-group"><label class="prop-label">Cor</label><input type="color" class="prop-color-input" value="${conn.color||'#555555'}" id="conn-color"/></div>
    <div class="prop-group"><label class="prop-label">Espessura</label>
      <input type="range" class="prop-input" id="conn-sw" min="0.5" max="8" step="0.5" value="${conn.strokeWidth||1.5}" style="padding:0"/>
      <span id="conn-sw-val" style="font-size:11px;color:#a6adc8">${conn.strokeWidth||1.5}px</span>
    </div>
    <div class="prop-group" style="font-size:10px;color:#6c7086">Duplo clique na seta para resetar o caminho e as portas</div>
    <button class="prop-btn danger" onclick="deleteConnection('${cid}')">Excluir conexão</button>`;

  document.getElementById('conn-label').addEventListener('input', e => { conn.label = e.target.value; renderConnections(); persistCurrentDiagram(); });
  document.getElementById('conn-type').addEventListener('change', e => { conn.type = e.target.value; renderConnections(); persistCurrentDiagram(); });
  document.getElementById('conn-fromport').addEventListener('change', e => { conn.fromPort = e.target.value; conn.waypoints = []; renderConnections(); persistCurrentDiagram(); });
  document.getElementById('conn-toport').addEventListener('change', e => { conn.toPort = e.target.value; conn.waypoints = []; renderConnections(); persistCurrentDiagram(); });
  document.getElementById('conn-color').addEventListener('input', e => { conn.color = e.target.value; renderConnections(); persistCurrentDiagram(); });
  document.getElementById('conn-sw').addEventListener('input', e => {
    conn.strokeWidth = parseFloat(e.target.value);
    document.getElementById('conn-sw-val').textContent = conn.strokeWidth + 'px';
    renderConnections(); persistCurrentDiagram();
  });
}

function setPropColor(prop, color) {
  const id = state.selected[0]; if (!id || id.startsWith('conn_')) return;
  const el = state.elements.find(e => e.id === id); if (!el) return;
  el[prop] = color; renderElements(); persistCurrentDiagram(); showProperties();
}

// ---- Context Menu ----
function showContextMenu(e) { if (!state.selected.length) return; const m = document.getElementById('context-menu'); m.style.left = e.clientX+'px'; m.style.top = e.clientY+'px'; m.classList.remove('hidden'); }
function hideContextMenu() { document.getElementById('context-menu').classList.add('hidden'); }
function ctxBringFront()   { state.selected.forEach(id => { const el = state.elements.find(e=>e.id===id); if(el) el.zIndex = Math.max(...state.elements.map(e=>e.zIndex||0))+1; }); renderElements(); renderSelection(); persistCurrentDiagram(); }
function ctxSendBack()     { state.selected.forEach(id => { const el = state.elements.find(e=>e.id===id); if(el) el.zIndex = Math.min(...state.elements.map(e=>e.zIndex||0))-1; }); renderElements(); renderSelection(); persistCurrentDiagram(); }
function ctxBringForward() { state.selected.forEach(id => { const el = state.elements.find(e=>e.id===id); if(el) el.zIndex = (el.zIndex||0)+1; }); renderElements(); renderSelection(); persistCurrentDiagram(); }
function ctxSendBackward() { state.selected.forEach(id => { const el = state.elements.find(e=>e.id===id); if(el) el.zIndex = (el.zIndex||0)-1; }); renderElements(); renderSelection(); persistCurrentDiagram(); }
function ctxDuplicate() {
  pushHistory();
  const newIds = [];
  state.selected.forEach(id => { const el = state.elements.find(e=>e.id===id); if(!el) return; const copy = {...JSON.parse(JSON.stringify(el)), id:genId(), x:el.x+20, y:el.y+20}; state.elements.push(copy); newIds.push(copy.id); });
  state.selected = newIds; renderElements(); renderConnections(); renderSelection(); persistCurrentDiagram();
}
function ctxGroup() {}
function ctxDelete() { deleteSelected(); }

function deleteSelected() {
  pushHistory();
  const connIds = state.selected.filter(id=>id.startsWith('conn_')).map(id=>id.replace('conn_',''));
  const elemIds = state.selected.filter(id=>!id.startsWith('conn_'));
  state.elements = state.elements.filter(e=>!elemIds.includes(e.id));
  state.connections = state.connections.filter(c=>!connIds.includes(c.id)&&!elemIds.includes(c.from)&&!elemIds.includes(c.to));
  state.selected = []; renderElements(); renderConnections(); renderSelection(); showProperties(); persistCurrentDiagram();
}
function deleteConnection(cid) {
  pushHistory(); state.connections = state.connections.filter(c=>c.id!==cid); state.selected = []; renderConnections(); showProperties(); persistCurrentDiagram();
}

// ---- Keyboard ----
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
    if (e.key==='Delete'||e.key==='Backspace') deleteSelected();
    if (e.key==='v'||e.key==='V') setTool('select');
    if (e.key==='h'||e.key==='H') setTool('pan');
    if (e.key==='c'||e.key==='C') setTool('connect');
    if (e.key==='t'||e.key==='T') setTool('text');
    if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='y') { e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='s') { e.preventDefault(); saveDiagram(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='d') { e.preventDefault(); ctxDuplicate(); }
    if (e.key==='Escape') { state.connecting = null; document.getElementById('temp-layer').innerHTML = ''; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      const d = e.shiftKey ? 10 : 1;
      state.selected.forEach(id => {
        if (id.startsWith('conn_')) return;
        const el = state.elements.find(el=>el.id===id); if (!el) return;
        if (e.key==='ArrowUp') el.y-=d; if (e.key==='ArrowDown') el.y+=d;
        if (e.key==='ArrowLeft') el.x-=d; if (e.key==='ArrowRight') el.x+=d;
      });
      renderElements(); renderConnections(); renderSelection();
    }
  });
}

// ---- Save / Load ----
function saveDiagram() { persistCurrentDiagram(); showToast('Diagrama salvo!'); }
function loadDiagramDialog() {
  const list = document.getElementById('saved-diagrams-list'); list.innerHTML = '';
  if (!state.diagrams.length) { list.innerHTML = '<div class="no-selection">Nenhum diagrama salvo</div>'; }
  else state.diagrams.forEach(d => {
    const item = document.createElement('div'); item.className = 'saved-item';
    item.innerHTML = `<div><div class="saved-item-name">${escHtml(d.name)}</div><div class="saved-item-date">${new Date(d.updated).toLocaleString('pt-BR')}</div></div><button class="saved-item-del" onclick="deleteDiagramFromList('${d.id}', event)">×</button>`;
    item.addEventListener('click', () => { openDiagram(d.id); closeModal(); }); list.appendChild(item);
  });
  showModal('modal-load');
}

function exportJSON() { persistCurrentDiagram(); const d = getCurrentDiagram(); if (!d) return; downloadFile(JSON.stringify(d,null,2), (d.name||'diagrama')+'.json', 'application/json'); }
function importJSON() { document.getElementById('file-input').click(); }
function handleFileImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result), id = 'diag_'+Date.now();
      state.diagrams.unshift({...data, id, name:data.name+' (importado)', created:new Date().toISOString(), updated:new Date().toISOString()});
      saveToStorage(); openDiagram(id); renderDiagramsList(); showToast('Diagrama importado!');
    } catch { alert('Erro ao importar: arquivo JSON inválido'); }
  };
  reader.readAsText(file); e.target.value = '';
}

function exportPNG() {
  persistCurrentDiagram();
  const svg = document.getElementById('canvas'), serializer = new XMLSerializer();
  const clone = svg.cloneNode(true);
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  state.elements.forEach(el => { minX=Math.min(minX,el.x); minY=Math.min(minY,el.y); maxX=Math.max(maxX,el.x+el.w); maxY=Math.max(maxY,el.y+el.h); });
  if (!isFinite(minX)) { minX=0; minY=0; maxX=800; maxY=600; }
  const pad=40, W=maxX-minX+pad*2, H=maxY-minY+pad*2;
  ['connections-layer','elements-layer','temp-layer'].forEach(id => { const g=clone.getElementById(id); if(g) g.setAttribute('transform',`translate(${-minX+pad}, ${-minY+pad})`); });
  clone.setAttribute('width',W); clone.setAttribute('height',H); clone.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect'); bg.setAttribute('width',W); bg.setAttribute('height',H); bg.setAttribute('fill','white'); clone.insertBefore(bg,clone.firstChild);
  const gridBg = clone.getElementById('grid-bg'); if (gridBg) gridBg.remove();
  const url = URL.createObjectURL(new Blob([serializer.serializeToString(clone)],{type:'image/svg+xml'}));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas'); canvas.width=W*2; canvas.height=H*2;
    const ctx = canvas.getContext('2d'); ctx.scale(2,2); ctx.fillStyle='white'; ctx.fillRect(0,0,W,H); ctx.drawImage(img,0,0);
    URL.revokeObjectURL(url);
    const d = getCurrentDiagram(); canvas.toBlob(b => downloadFile(b,(d?.name||'diagrama')+'.png','image/png'),'image/png');
  };
  img.src = url;
}

function exportPDF() {
  persistCurrentDiagram();
  const svg = document.getElementById('canvas'), serializer = new XMLSerializer();
  const clone = svg.cloneNode(true);
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  state.elements.forEach(el => { minX=Math.min(minX,el.x); minY=Math.min(minY,el.y); maxX=Math.max(maxX,el.x+el.w); maxY=Math.max(maxY,el.y+el.h); });
  if (!isFinite(minX)) { minX=0; minY=0; maxX=800; maxY=600; }
  const pad=40, W=maxX-minX+pad*2, H=maxY-minY+pad*2;
  ['connections-layer','elements-layer','temp-layer'].forEach(id => { const g=clone.getElementById(id); if(g) g.setAttribute('transform',`translate(${-minX+pad}, ${-minY+pad})`); });
  clone.setAttribute('width',W); clone.setAttribute('height',H); clone.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect'); bg.setAttribute('width',W); bg.setAttribute('height',H); bg.setAttribute('fill','white'); clone.insertBefore(bg,clone.firstChild);
  const gridBg = clone.getElementById('grid-bg'); if (gridBg) gridBg.remove();
  const d = getCurrentDiagram(), printWin = window.open('','_blank');
  printWin.document.write(`<!DOCTYPE html><html><head><title>${escHtml(d?.name||'Diagrama')}</title><style>body{margin:0;background:white}svg{max-width:100%;height:auto}@media print{body{display:block}}</style></head><body>${serializer.serializeToString(clone)}<script>window.onload=()=>window.print()<\/script></body></html>`);
  printWin.document.close();
}

// ---- Helpers ----
function svgEl(tag, attrs={}) { const el=document.createElementNS('http://www.w3.org/2000/svg',tag); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); return el; }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function downloadFile(content, filename, type) { const blob=content instanceof Blob?content:new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function showToast(msg) { const t=document.createElement('div'); t.textContent=msg; t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#cba6f7;color:#1e1e2e;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3)'; document.body.appendChild(t); setTimeout(()=>t.remove(),2000); }
function showModal(id) { document.getElementById('modal-overlay').classList.remove('hidden'); document.getElementById(id).classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')); }
