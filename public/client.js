'use strict';

const GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'];
const TOKEN_COLORS = [...GEM_COLORS, 'gold'];
const COLOR_LABELS = {
  white: '白',
  blue: '蓝',
  green: '绿',
  red: '红',
  black: '黑',
  gold: '金'
};
const LEVEL_LABELS = {
  1: '一级发展卡',
  2: '二级发展卡',
  3: '三级发展卡'
};

const app = document.getElementById('app');
const toast = document.getElementById('toast');

const session = {
  roomId: localStorage.getItem('splendor_room_id') || '',
  playerId: localStorage.getItem('splendor_player_id') || ''
};

let state = null;
let eventSource = null;

const ui = {
  tab: 'create',
  mode: null,
  selectedGems: [],
  returnSelection: []
};

function tokenClass(color) {
  return `token-${color}`;
}

function tokenChipHtml(color, count, opts = {}) {
  const label = COLOR_LABELS[color];
  const smallClass = opts.small ? ' small' : '';
  const icon = `<img class="gem-icon" src="/assets/gem-${color}.svg" alt="" />`;
  return `<span class="token-chip ${tokenClass(color)}${smallClass}" title="${label}宝石">${icon}<span class="chip-label">${label}</span>${opts.showCount === false ? '' : `<span class="chip-count">${count}</span>`}</span>`;
}

function tokensToChips(tokens, opts = {}) {
  return TOKEN_COLORS.map((color) => {
    const count = tokens[color] || 0;
    if (!opts.showZero && count === 0) return '';
    return tokenChipHtml(color, count, opts);
  }).join('');
}

function costBadges(cost) {
  return Object.keys(cost || {})
    .filter((color) => cost[color] > 0)
    .map((color) => {
      const dot = `<img class="gem-icon cost-gem" src="/assets/gem-${color}.svg" alt="" />`;
      return `<span class="cost-item">${dot}${cost[color]}</span>`;
    })
    .join('');
}

function bonusDot(color) {
  return `<img class="card-bonus" src="/assets/gem-${color}.svg" alt="" title="${COLOR_LABELS[color]}加成" />`;
}

function cardCostAfterDiscount(card, player) {
  const cost = {};
  for (const color of GEM_COLORS) {
    cost[color] = Math.max(0, (card.cost[color] || 0) - (player.bonuses[color] || 0));
  }
  return cost;
}

function canAfford(card, player) {
  const cost = cardCostAfterDiscount(card, player);
  const missing = GEM_COLORS.reduce(
    (sum, color) => sum + Math.max(0, cost[color] - (player.tokens[color] || 0)),
    0
  );
  return missing <= (player.tokens.gold || 0);
}

function sumTokens(tokens) {
  return TOKEN_COLORS.reduce((sum, color) => sum + (tokens[color] || 0), 0);
}

function canTakeThree() {
  return GEM_COLORS.filter((color) => state.bank[color] > 0).length >= 3;
}

function canTakeTwo() {
  return GEM_COLORS.some((color) => state.bank[color] >= 4);
}

function currentPlayer() {
  return state.players.find((player) => player.id === state.currentPlayerId);
}

function you() {
  return state.players.find((player) => player.id === state.youId);
}

function isYourTurn() {
  return state.status === 'playing' && state.currentPlayerId === state.youId;
}

function hasPendingForYou() {
  return state.pendingDiscard?.playerId === state.youId
    || state.pendingNoble?.playerId === state.youId;
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.className = 'toast';
  }, 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function saveSession(roomId, playerId) {
  session.roomId = roomId;
  session.playerId = playerId;
  localStorage.setItem('splendor_room_id', roomId);
  localStorage.setItem('splendor_player_id', playerId);
}

function clearSession() {
  session.roomId = '';
  session.playerId = '';
  localStorage.removeItem('splendor_room_id');
  localStorage.removeItem('splendor_player_id');
}

function connectEvents() {
  if (!session.roomId || !session.playerId) return;
  if (eventSource) eventSource.close();

  eventSource = new EventSource(
    `/api/rooms/${encodeURIComponent(session.roomId)}/events?playerId=${encodeURIComponent(session.playerId)}`
  );

  eventSource.addEventListener('state', (event) => {
    state = JSON.parse(event.data);
    ui.mode = null;
    ui.selectedGems = [];
    ui.returnSelection = [];
    render();
  });

  eventSource.onerror = () => {
    // EventSource 会自动重连；仅提示一次轻量连接状态。
  };
}

function render() {
  if (!state) {
    renderLobby();
    return;
  }

  if (state.status === 'waiting') {
    renderWaitingRoom();
    return;
  }

  renderGame();
}

function renderLobby() {
  const createActive = ui.tab === 'create';
  app.innerHTML = `
    <section class="screen lobby">
      <div class="hero">
        <h1>璀璨宝石</h1>
        <p>Splendor 在线联机版 · 最多 4 名玩家</p>
      </div>
      <div class="panel">
        <div class="tabs">
          <button class="tab ${createActive ? 'active' : ''}" data-action="show-create">创建房间</button>
          <button class="tab ${!createActive ? 'active' : ''}" data-action="show-join">加入房间</button>
        </div>
        ${
          createActive
            ? `
          <form class="form-stack" data-form="create">
            <div class="field">
              <label for="create-name">你的昵称</label>
              <input id="create-name" name="name" maxlength="20" autocomplete="off" value="${escapeHtml(localStorage.getItem('splendor_name') || '')}" required />
            </div>
            <div class="field">
              <label for="max-players">房间人数</label>
              <select id="max-players" name="maxPlayers">
                <option value="2">2 人</option>
                <option value="3">3 人</option>
                <option value="4" selected>4 人</option>
              </select>
            </div>
            <button class="primary" type="submit">创建房间</button>
          </form>
          `
            : `
          <form class="form-stack" data-form="join">
            <div class="field">
              <label for="join-name">你的昵称</label>
              <input id="join-name" name="name" maxlength="20" autocomplete="off" value="${escapeHtml(localStorage.getItem('splendor_name') || '')}" required />
            </div>
            <div class="field">
              <label for="room-code">房间码</label>
              <input id="room-code" name="roomId" maxlength="8" autocomplete="off" placeholder="例如：1A2B3C4D" required />
            </div>
            <button class="primary" type="submit">加入房间</button>
          </form>
          `
        }
      </div>
    </section>
  `;
}

function renderWaitingRoom() {
  const host = state.players.find((player) => player.id === state.hostId);
  const canStart = state.youId === state.hostId && state.players.length >= 2;

  app.innerHTML = `
    <section class="screen lobby">
      <div class="panel">
        <div class="space-between">
          <div>
            <div class="muted small">房间码</div>
            <div class="room-code">${escapeHtml(state.roomId)}</div>
          </div>
          <button class="ghost" data-action="copy-room">复制房间码</button>
        </div>

        <div class="player-list">
          ${state.players.map((player) => `
            <div class="player-list-item">
              <div>
                <strong>${escapeHtml(player.name)}</strong>
                ${player.id === state.hostId ? '<span class="host-tag">房主</span>' : ''}
                ${player.id === state.youId ? '<span class="muted small">（你）</span>' : ''}
              </div>
              <div class="muted small">等待中</div>
            </div>
          `).join('')}
        </div>

        <div class="row" style="margin-top: 18px;">
          <button class="primary" data-action="start-game" ${canStart ? '' : 'disabled'}>
            ${state.youId === state.hostId ? '开始游戏' : `等待房主 ${escapeHtml(host?.name || '')} 开始`}
          </button>
          <button class="danger ghost" data-action="leave-room">退出房间</button>
        </div>
        <p class="muted small" style="margin-bottom: 0;">
          将房间码分享给好友，好友选择“加入房间”即可加入。房间人数：${state.players.length}/${state.maxPlayers}。
        </p>
      </div>
    </section>
  `;
}

function renderGame() {
  const me = you();
  const current = currentPlayer();
  const isMyTurn = isYourTurn();
  const canAct = isMyTurn && !hasPendingForYou();

  app.innerHTML = `
    <section class="screen game">
      <div class="game-header">
        <div>
          <span class="muted small">房间 ${escapeHtml(state.roomId)}</span>
          <span class="turn-chip ${isMyTurn ? 'current' : ''}">
            ${state.status === 'finished'
              ? '对局结束'
              : `当前回合：${escapeHtml(current?.name || '')}${isMyTurn ? '（你）' : ''}`}
          </span>
          ${state.finalRound ? '<span class="turn-chip">最后一轮</span>' : ''}
        </div>
        <div class="row">
          <button class="ghost" data-action="copy-room">复制房间码</button>
          <button class="ghost danger" data-action="leave-room">退出</button>
        </div>
      </div>

      <div class="players-grid">
        ${state.players.map((player) => renderPlayerCard(player)).join('')}
      </div>

      <div class="panel board-section">
        <div class="section-title">
          <span>贵族板块</span>
        </div>
        <div class="noble-row">
          ${state.nobles.length
            ? state.nobles.map((noble) => `
                <div class="noble-card" style="background-image:url('${noble.image}')">
                  <div class="noble-points">${noble.points}</div>
                  <div class="card-costs">${costBadges(noble.cost)}</div>
                </div>
              `).join('')
            : '<span class="muted small">贵族已被全部迎走</span>'}
        </div>

        <div class="section-title" style="margin-top: 20px;">
          <span>宝石供应区</span>
          <span class="muted small">${isMyTurn ? '你的回合' : '等待其他玩家操作'}</span>
        </div>
        <div class="bank-row">
          ${TOKEN_COLORS.map((color) => `
            <button
              class="bank-pile ${isGemSelected(color) ? 'selected' : ''}"
              data-action="bank-token"
              data-color="${color}"
              ${isBankSelectable(color) ? '' : 'disabled'}
              style="text-align:center;"
            >
              <img class="bank-gem" src="/assets/gem-${color}.svg" alt="" />
              <span class="bank-count">${state.bank[color]}</span>
            </button>
          `).join('')}
        </div>
        ${!hasPendingForYou() ? renderGemActions(me, canAct) : ''}
      </div>

      ${[3, 2, 1].map((level) => renderLevel(level, canAct)).join('')}

      ${renderMyPanel(me, canAct)}
      ${renderPendingNoble(me)}
      ${renderWinnerOverlay()}
    </section>
  `;
}

function renderPlayerCard(player) {
  const active = player.id === state.currentPlayerId && state.status === 'playing';
  const isYou = player.id === state.youId;
  return `
    <div class="player-card ${active ? 'active' : ''} ${isYou ? 'you' : ''}">
      <div class="player-head">
        <div>
          <span class="player-name">${escapeHtml(player.name)}</span>
          ${isYou ? '<span class="muted small">（你）</span>' : ''}
          ${player.id === state.hostId ? '<span class="host-tag">房主</span>' : ''}
        </div>
        <div class="score-badge">${player.score}</div>
      </div>
      <div class="player-stat">
        <div class="player-stat-label">宝石</div>
        <div class="token-line">
          ${tokensToChips(player.tokens, { small: true })}
        </div>
      </div>
      <div class="player-stat">
        <div class="player-stat-label">加成</div>
        <div class="token-line">
          ${GEM_COLORS.map((color) => {
            const count = player.bonuses[color] || 0;
            if (!count) return '';
            return `<span class="token-chip ${tokenClass(color)} small"><img class="gem-icon" src="/assets/gem-${color}.svg" alt="" /><span class="chip-count">×${count}</span></span>`;
          }).join('') || '<span class="muted small">—</span>'}
        </div>
      </div>
      <div class="player-meta">
        <span class="token-chip small">保留 ${player.reservedCount}</span>
        <span class="token-chip small">贵族 ${player.nobles.length}</span>
      </div>
      ${player.nobles.length
        ? `<div class="token-line">${player.nobles.map((noble) => `<span class="token-chip token-gold small">贵族 ${noble.points}</span>`).join('')}</div>`
        : ''}
    </div>
  `;
}

function isBankSelectable(color) {
  if (!state || state.status !== 'playing') return false;
  if (!isYourTurn()) return false;
  if (hasPendingForYou()) return false;

  if (ui.mode === 'take3') {
    return GEM_COLORS.includes(color) && state.bank[color] > 0;
  }
  if (ui.mode === 'take2') {
    return GEM_COLORS.includes(color) && state.bank[color] >= 4;
  }
  // 没有选择行动时，直接点击宝石进入“拿 3 枚不同色”的选择流程。
  return GEM_COLORS.includes(color) && state.bank[color] > 0;
}

function isGemSelected(color) {
  if (ui.mode === 'take2') {
    return ui.selectedGems[0] === color;
  }
  return ui.selectedGems.includes(color);
}

function renderLevel(level, canAct) {
  const cards = state.faceUp[level] || [];
  const deckCount = state.deckCounts[level] || 0;
  const me = you();

  return `
    <div class="level-section">
      <div class="section-title">
        <span>${LEVEL_LABELS[level]}</span>
        <span class="muted small">牌堆剩余 ${deckCount}</span>
      </div>
      <div class="cards-row">
        ${cards.map((card) => renderCard(card, canAct, me)).join('')}
        <div class="deck-card" style="background-image:url('/assets/decks/deck${level}.jpg')">
          <div class="deck-count">${deckCount}</div>
          <button
            data-action="reserve-deck"
            data-level="${level}"
            ${canAct && me.reservedCount < 3 && deckCount > 0 ? '' : 'disabled'}
          >保留牌堆顶牌</button>
        </div>
      </div>
    </div>
  `;
}

function renderCard(card, canAct, me) {
  const affordable = canAfford(card, me);
  const selected = ui.mode === 'reserve' && ui.selectedGems.includes(card.id);

  return `
    <div class="card-slot">
      <div class="card level-${card.level} card-photo ${selected ? 'selected' : ''}" style="background-image:url('${card.image}')"></div>
      ${
        canAct
          ? `
          <div class="card-actions">
            <button data-action="buy-card" data-card-id="${card.id}" ${affordable ? '' : 'disabled'}>购买</button>
            <button data-action="reserve-card" data-card-id="${card.id}" ${me.reservedCount < 3 ? '' : 'disabled'}>保留</button>
          </div>
          `
          : ''
      }
    </div>
  `;
}

function renderMyPanel(me, canAct) {
  const pendingDiscardForYou = state.pendingDiscard?.playerId === state.youId;

  return `
    <div class="panel my-panel">
      <div class="section-title">
        <span>我的手牌</span>
        <span class="muted small">宝石 ${sumTokens(me.tokens)} / 10</span>
      </div>
      <div class="hand-gems">
        ${TOKEN_COLORS.map((color) => `
          <div class="hand-gem">
            <img class="gem-icon" src="/assets/gem-${color}.svg" alt="" />
            <span class="hand-gem-count">${me.tokens[color] || 0}</span>
            <span class="hand-gem-label">${COLOR_LABELS[color]}宝石</span>
          </div>
        `).join('')}
      </div>
      ${pendingDiscardForYou ? renderDiscardPicker(me) : ''}
      <div class="section-title" style="margin-top: 18px;">
        <span>我保留的卡牌</span>
        <span class="muted small">${me.reservedCount} / 3</span>
      </div>
      <div class="reserved-list">
        ${me.reserved.length
          ? me.reserved.map((card) => renderReservedCard(card, me, canAct)).join('')
          : '<span class="muted small">尚未保留卡牌。</span>'}
      </div>
    </div>
  `;
}

function renderGemActions(me, canAct) {
  const canConfirmGems =
    (ui.mode === 'take3' && ui.selectedGems.length === 3)
    || (ui.mode === 'take2' && ui.selectedGems.length === 2);

  return `
    <div class="gem-actions">
      <div class="action-buttons compact">
        <button
          class="${ui.mode === 'take3' ? 'active' : ''}"
          data-action="take-three"
          ${canAct && canTakeThree() ? '' : 'disabled'}
        >拿 3 枚不同色</button>
        <button
          class="${ui.mode === 'take2' ? 'active' : ''}"
          data-action="take-two"
          ${canAct && canTakeTwo() ? '' : 'disabled'}
        >拿 2 枚同色</button>
        <button
          class="ghost"
          data-action="cancel-mode"
          ${ui.mode ? '' : 'disabled'}
        >取消选择</button>
      </div>
      <div class="selection-help">
        ${ui.mode ? selectionHelpText() : '点击上方宝石可直接开始选择；也可购买或保留发展卡。'}
      </div>
      ${canConfirmGems ? `
        <button class="primary" data-action="confirm-gems">确认拿取</button>
      ` : ''}
    </div>
  `;
}

function renderDiscardPicker(me) {
  const needed = state.pendingDiscard?.count || 0;
  return `
    <div class="panel" style="margin-top: 14px; background: rgba(15, 28, 43, 0.72);">
      <div class="section-title">
        <span>选择要归还的宝石</span>
        <span class="muted small">已选 ${ui.returnSelection.length} / ${needed}</span>
      </div>
      <div class="bank-row">
        ${TOKEN_COLORS.map((color) => {
          const available = me.tokens[color] - countInArray(ui.returnSelection, color);
          return `
            <button
              class="bank-pile"
              data-action="return-token"
              data-color="${color}"
              ${available > 0 && ui.returnSelection.length < needed ? '' : 'disabled'}
            >
              <span class="bank-count">${me.tokens[color]}</span>
              <span class="token-chip ${tokenClass(color)} small">${COLOR_LABELS[color]}</span>
            </button>
          `;
        }).join('')}
      </div>
      <button
        class="primary"
        data-action="confirm-return"
        style="margin-top: 12px;"
        ${ui.returnSelection.length === needed ? '' : 'disabled'}
      >确认归还</button>
    </div>
  `;
}

function renderReservedCard(card, me, canAct) {
  const affordable = canAfford(card, me);
  return `
    <div class="card-slot">
      <div class="card level-${card.level} card-photo" style="background-image:url('${card.image}')"></div>
      ${
        canAct
          ? `
          <div class="card-actions">
            <button data-action="buy-reserved" data-card-id="${card.id}" ${affordable ? '' : 'disabled'}>购买</button>
          </div>
          `
          : ''
      }
    </div>
  `;
}

function renderPendingNoble(me) {
  if (!state.pendingNoble || state.pendingNoble.playerId !== state.youId) return '';

  const options = state.nobles.filter((noble) =>
    state.pendingNoble.optionIds.includes(noble.id)
  );

  return `
    <div class="overlay">
      <div class="panel overlay-panel">
        <h2>有贵族来访</h2>
        <p>你的发展卡加成满足了多位贵族，请选择迎接一位。</p>
        <div class="noble-row" style="justify-content: center;">
          ${options.map((noble) => `
            <button class="noble-card" data-action="choose-noble" data-noble-id="${noble.id}" style="background-image:url('${noble.image}')">
              <div class="noble-points">${noble.points}</div>
              <div class="card-costs">${costBadges(noble.cost)}</div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderWinnerOverlay() {
  if (state.status !== 'finished' || !state.winner) return '';

  const winners = state.players
    .filter((player) => state.winner.includes(player.id))
    .map((player) => escapeHtml(player.name))
    .join('、');
  const won = state.winner.includes(state.youId);

  return `
    <div class="overlay">
      <div class="panel overlay-panel">
        <h2>${won ? '你获胜了！' : '对局结束'}</h2>
        <p>胜利者：${winners}</p>
        <div class="player-list">
          ${state.players
            .slice()
            .sort((a, b) => b.score - a.score || a.cards.length - b.cards.length)
            .map((player) => `
              <div class="player-list-item">
                <strong>${escapeHtml(player.name)}</strong>
                <span>${player.score} 分 · ${player.cards.length} 张卡</span>
              </div>
            `).join('')}
        </div>
        <button class="primary" data-action="new-room" style="margin-top: 16px;">返回大厅</button>
      </div>
    </div>
  `;
}

function selectionHelpText() {
  if (ui.mode === 'take3') {
    return `已选择 ${ui.selectedGems.length}/3 枚不同色宝石，点击上方供应区宝石选择，然后确认。`;
  }
  if (ui.mode === 'take2') {
    const color = ui.selectedGems[0];
    return color
      ? `已选择 ${COLOR_LABELS[color]}宝石 2 枚，点击确认拿取。`
      : '选择一种库存至少 4 枚的宝石，一次拿取 2 枚。';
  }
  return '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function handleCreate(form) {
  const name = form.elements.name.value.trim();
  const maxPlayers = Number(form.elements.maxPlayers.value);
  if (!name) {
    showToast('请输入昵称', true);
    return;
  }

  localStorage.setItem('splendor_name', name);
  const data = await api('/api/rooms', {
    method: 'POST',
    body: { name, maxPlayers }
  });
  saveSession(data.roomId, data.playerId);
  state = data.state;
  connectEvents();
  render();
}

async function handleJoin(form) {
  const name = form.elements.name.value.trim();
  const roomId = form.elements.roomId.value.trim().toUpperCase();
  if (!name || !roomId) {
    showToast('请输入昵称和房间码', true);
    return;
  }

  localStorage.setItem('splendor_name', name);
  const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    body: { name }
  });
  saveSession(data.roomId, data.playerId);
  state = data.state;
  connectEvents();
  render();
}

async function startGame() {
  const data = await api(`/api/rooms/${encodeURIComponent(session.roomId)}/start`, {
    method: 'POST',
    body: { playerId: session.playerId }
  });
  state = data.state;
  render();
}

async function sendAction(action) {
  const data = await api(`/api/rooms/${encodeURIComponent(session.roomId)}/action`, {
    method: 'POST',
    body: { playerId: session.playerId, action }
  });
  state = data.state;
  render();
}

async function copyRoom() {
  try {
    await navigator.clipboard.writeText(state.roomId);
    showToast('房间码已复制');
  } catch {
    showToast(`房间码：${state.roomId}`);
  }
}

async function leaveRoom() {
  clearSession();
  if (eventSource) eventSource.close();
  eventSource = null;
  state = null;
  render();
}

function selectBankToken(color) {
  if (!isYourTurn() || hasPendingForYou()) return;

  if (!ui.mode) {
    ui.mode = 'take3';
    ui.selectedGems = [color];
    render();
    return;
  }

  if (ui.mode === 'take3') {
    if (!GEM_COLORS.includes(color)) return;
    const index = ui.selectedGems.indexOf(color);
    if (index >= 0) {
      ui.selectedGems.splice(index, 1);
    } else if (ui.selectedGems.length < 3) {
      ui.selectedGems.push(color);
    }
    render();
  } else if (ui.mode === 'take2') {
    if (!GEM_COLORS.includes(color) || state.bank[color] < 4) return;
    ui.selectedGems = [color, color];
    render();
  }
}

async function confirmGems() {
  if (ui.mode === 'take3' && ui.selectedGems.length === 3) {
    await sendAction({ type: 'takeGems', colors: ui.selectedGems });
  } else if (ui.mode === 'take2' && ui.selectedGems.length === 2) {
    await sendAction({ type: 'takeGems', colors: ui.selectedGems });
  }
}

async function selectReturnToken(color) {
  const me = you();
  const needed = state.pendingDiscard?.count || 0;
  const index = ui.returnSelection.indexOf(color);
  if (index >= 0) {
    ui.returnSelection.splice(index, 1);
  } else if (ui.returnSelection.length < needed && (me.tokens[color] || 0) > countInArray(ui.returnSelection, color)) {
    ui.returnSelection.push(color);
  }
  render();
}

function countInArray(array, value) {
  return array.filter((item) => item === value).length;
}

async function confirmReturnTokens() {
  const needed = state.pendingDiscard?.count || 0;
  if (ui.returnSelection.length !== needed) return;
  await sendAction({ type: 'returnTokens', colors: ui.returnSelection });
}

async function chooseNoble(nobleId) {
  await sendAction({ type: 'chooseNoble', nobleId });
}

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();

  try {
    if (form.dataset.form === 'create') {
      await handleCreate(form);
    } else if (form.dataset.form === 'join') {
      await handleJoin(form);
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;

  try {
    if (action === 'show-create') {
      ui.tab = 'create';
      render();
    } else if (action === 'show-join') {
      ui.tab = 'join';
      render();
    } else if (action === 'copy-room') {
      await copyRoom();
    } else if (action === 'start-game') {
      await startGame();
    } else if (action === 'leave-room') {
      await leaveRoom();
    } else if (action === 'new-room') {
      await leaveRoom();
    } else if (action === 'take-three') {
      ui.mode = 'take3';
      ui.selectedGems = [];
      render();
    } else if (action === 'take-two') {
      ui.mode = 'take2';
      ui.selectedGems = [];
      render();
    } else if (action === 'cancel-mode') {
      ui.mode = null;
      ui.selectedGems = [];
      render();
    } else if (action === 'bank-token') {
      selectBankToken(target.dataset.color);
    } else if (action === 'confirm-gems') {
      await confirmGems();
    } else if (action === 'buy-card') {
      await sendAction({
        type: 'buyCard',
        payload: { cardId: target.dataset.cardId }
      });
    } else if (action === 'buy-reserved') {
      await sendAction({
        type: 'buyCard',
        payload: { cardId: target.dataset.cardId }
      });
    } else if (action === 'reserve-card') {
      await sendAction({
        type: 'reserveCard',
        payload: { source: 'faceUp', cardId: target.dataset.cardId }
      });
    } else if (action === 'reserve-deck') {
      await sendAction({
        type: 'reserveCard',
        payload: { source: 'deck', level: Number(target.dataset.level) }
      });
    } else if (action === 'choose-noble') {
      await chooseNoble(target.dataset.nobleId);
    } else if (action === 'return-token') {
      selectReturnToken(target.dataset.color);
    } else if (action === 'confirm-return') {
      await confirmReturnTokens();
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

async function boot() {
  if (!session.roomId || !session.playerId) {
    state = null;
    render();
    return;
  }

  app.innerHTML = `
    <section class="screen lobby">
      <div class="hero"><h1>璀璨宝石</h1><p>正在重新连接房间…</p></div>
    </section>
  `;

  try {
    const data = await api(
      `/api/rooms/${encodeURIComponent(session.roomId)}?playerId=${encodeURIComponent(session.playerId)}`
    );
    state = data.state;
    connectEvents();
    render();
  } catch (error) {
    clearSession();
    state = null;
    render();
    showToast(error.message, true);
  }
}

boot();
