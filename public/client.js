'use strict';

const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const ALL_COLORS = [...COLORS, 'gold'];
const LABEL = { white: '月白', blue: '潮蓝', green: '松绿', red: '珊红', black: '暮紫', gold: '金砂' };
const LEVEL = { 1: '基础', 2: '精工', 3: '典藏' };
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const invite = (new URL(location.href).searchParams.get('room') || '').toUpperCase();
const savedRoom = localStorage.getItem('guild_room');
let session = !invite || invite === savedRoom
  ? { roomId: savedRoom, key: localStorage.getItem('guild_key') }
  : null;
let state = null;
let stream = null;
let connected = false;
let busy = false;
let joining = false;
let chatBusy = false;
let lobbyTab = /^[0-9A-F]{8}$/.test(invite) ? 'join' : 'create';
let selection = [];
let selectionMode = 'split';
let returns = [];
let lastMessageId = 0;
let unread = 0;
let mobileChatOpen = false;
let toastTimer;
const desktop = matchMedia('(min-width: 1000px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const soundtrack = new Audio();
soundtrack.preload = 'none';
soundtrack.loop = true;
soundtrack.volume = 0.38;
soundtrack.src = '/media/workshop-at-night.mp3';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
);
const gem = color => `<i class="gem gem-${color}" aria-hidden="true"></i>`;
const you = () => state.players.find(player => player.id === state.youId);
const myTurn = () => state?.status === 'playing' && state.currentId === state.youId;
const canAct = () => myTurn() && !state.returnCount && connected && !busy;
const count = (colors, color) => colors.filter(item => item === color).length;
const disabled = value => value ? 'disabled' : '';
const roomPath = (command = '') => `/api/rooms/${session.roomId}${command ? '/' + command : ''}`;

function notify(text, error = false) {
  toast.textContent = text;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3300);
}

async function api(path, body, key) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function brand() {
  return '<div class="brand"><i class="brand-mark" aria-hidden="true"></i><span>棱境商会</span></div>';
}

function musicControl() {
  return `<button class="music-toggle" type="button" data-action="music" aria-label="工坊配乐" aria-pressed="${!soundtrack.paused}" title="工坊夜曲 · 播放或暂停">
    <span class="music-glyph" aria-hidden="true">♫</span><span class="music-label" aria-hidden="true">音乐</span>
  </button>`;
}

function syncMusicControl() {
  document.querySelector('.music-toggle')?.setAttribute('aria-pressed', String(!soundtrack.paused));
}

soundtrack.addEventListener('play', syncMusicControl);
soundtrack.addEventListener('pause', syncMusicControl);

async function toggleMusic() {
  if (!soundtrack.paused) {
    soundtrack.pause();
    syncMusicControl();
    return;
  }
  try {
    if (soundtrack.error) soundtrack.load();
    const playing = soundtrack.play();
    syncMusicControl();
    await playing;
  } catch (error) {
    if (error.name !== 'AbortError') notify('配乐暂时无法播放，请重试。', true);
  } finally {
    syncMusicControl();
  }
}

function renderLobby(name = localStorage.getItem('guild_name') || '', reconnect = false) {
  const create = lobbyTab === 'create';
  app.innerHTML = `
    <header class="site-header"><div class="header-inner">${brand()}${musicControl()}</div></header>
    <main class="lobby">
      <section class="welcome">
        <div class="welcome-copy"><h1>棱境商会</h1><p>采集宝石，制作作品，完成商会委托。</p></div>
      </section>
      <section class="entry panel">
        ${reconnect ? '<h2>正在返回房间…</h2>' : `
          <div class="entry-switch">
            <button type="button" data-action="tab" data-tab="create" aria-pressed="${create}">创建房间</button>
            <button type="button" data-action="tab" data-tab="join" aria-pressed="${!create}">加入房间</button>
          </div>
          <form id="entry-form" data-form="${lobbyTab}">
            <label for="nickname">昵称</label>
            <input id="nickname" name="name" maxlength="20" autocomplete="nickname" value="${esc(name)}" placeholder="输入你的昵称" required>
            ${create ? `
              <label for="capacity">房间上限</label>
              <select id="capacity" name="capacity"><option value="2">2 人</option><option value="3">3 人</option><option value="4" selected>4 人</option></select>` : `
              <label for="room-code">房间码</label>
              <input id="room-code" name="room" maxlength="8" pattern="[A-Fa-f0-9]{8}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="输入 8 位房间码" value="${esc(invite)}" required>`}
            <button class="primary" type="submit">${create ? '创建房间' : '加入房间'}</button>
          </form>`}
      </section>
    </main>`;
}

function mountRoom() {
  selection = [];
  selectionMode = 'split';
  returns = [];
  lastMessageId = 0;
  unread = 0;
  mobileChatOpen = false;
  app.innerHTML = `
    <header class="site-header">
      <div class="header-inner">${brand()}
        <div class="header-actions">
          <span id="connection" role="status"></span>
          ${musicControl()}
          <button class="room-code" data-action="invite" title="复制邀请链接"><span>邀请</span><b>${esc(session.roomId)}</b></button>
        </div>
      </div>
    </header>
    <main class="room-layout">
      <div id="table"></div>
      <aside class="sidebar">
        <section class="panel players"><div class="section-head"><h2>席位</h2><span id="seat-count" class="muted"></span></div><div id="players"></div></section>
        <section class="panel chat" aria-labelledby="chat-title" id="chat">
          <div class="section-head"><h2 id="chat-title">房间聊天</h2><button class="chat-close" data-action="chat-toggle" aria-label="关闭聊天">×</button></div>
          <div class="messages" id="messages" role="log" aria-label="聊天消息" tabindex="0"><p class="empty">还没有消息。</p></div>
          <form data-form="chat" class="chat-form">
            <input name="message" maxlength="300" autocomplete="off" aria-label="聊天消息" placeholder="发给同桌玩家…" required>
            <button type="submit" class="primary" id="chat-send">发送</button>
          </form>
        </section>
      </aside>
    </main>
    <button class="chat-toggle primary" data-action="chat-toggle" aria-expanded="false" aria-controls="chat">聊天 <span id="unread" hidden></span></button>`;
}

function update(id, html) {
  const element = document.getElementById(id);
  if (element && element.rendered !== html) {
    element.innerHTML = html;
    element.rendered = html;
  }
}

function showConnection() {
  const element = document.querySelector('#connection');
  if (!element) return;
  element.classList.toggle('online', connected);
  element.textContent = connected ? '已连接' : '正在连接';
  document.querySelector('#chat-send').disabled = !connected || chatBusy;
}

function acceptState(next) {
  if (state && next.revision <= state.revision) return;
  const transfers = captureTransfers(state, next);
  selection = [];
  selectionMode = 'split';
  returns = [];
  state = next;
  renderRoom();
  transfers.forEach(animateTransfer);
}

function captureTransfers(before, after) {
  if (reducedMotion.matches || before?.status !== 'playing' || after.revision !== before.revision + 1) return [];
  const player = before.players.find(item => item.id === before.currentId);
  const updated = after.players.find(item => item.id === player.id);
  if (!updated) return [];
  const own = player.id === before.youId;
  const seat = document.getElementById('seat-' + player.id);
  const transfers = [];

  for (const color of ALL_COLORS) {
    const gained = Math.min(updated.tokens[color] - player.tokens[color], before.bank[color] - after.bank[color]);
    if (gained <= 0) continue;
    const gem = document.querySelector(`.pile[data-color="${color}"] .gem`);
    if (!gem) continue;
    for (let i = 0; i < gained; i += 1) {
      transfers.push({
        kind: 'gem',
        piece: gem.cloneNode(),
        from: gem.getBoundingClientRect(),
        destination: own ? '#stock-tokens' : '#seat-' + player.id + ' .seat-tokens',
        color
      });
    }
  }

  const crafted = COLORS.find(color => updated.bonuses[color] > player.bonuses[color]);
  const reserved = updated.reservedCount > player.reservedCount;
  if (crafted || reserved) {
    const marketCard = Object.values(before.market).flat().find(card =>
      card && !after.market[card.level].some(item => item?.id === card.id)
    );
    const heldCard = crafted && player.reserved.find(card => !updated.reserved.some(item => item.id === card.id));
    const removed = marketCard || heldCard;
    const work = removed && document.getElementById('card-' + removed.id);
    const face = work?.querySelector('.work-face');
    const deckLevel = reserved && [1, 2, 3].find(level => after.deckCounts[level] < before.deckCounts[level]);
    const source = face || (deckLevel && document.getElementById('deck-' + deckLevel)) || seat?.querySelector('.seat-reserved');
    if (source) {
      const piece = work ? work.cloneNode(false) : document.createElement('div');
      if (face) {
        piece.removeAttribute('id');
        piece.append(face.cloneNode(true));
      } else piece.className = 'flight-back';
      transfers.push({
        kind: 'card',
        piece,
        from: source.getBoundingClientRect(),
        destination: crafted && own ? '#stock-bonuses' : '#seat-' + player.id + (crafted ? ' .seat-bonuses' : ' .seat-reserved'),
        color: crafted
      });
    }
  }
  return transfers;
}

function animateTransfer({ kind, piece, from, destination, color }, index) {
  const group = document.querySelector(destination);
  const target = (color && group?.querySelector(`.fee[data-color="${color}"]`)) || group;
  if (!target || !from.width || !from.height || reducedMotion.matches || !piece.animate) return;
  const to = target.getBoundingClientRect();
  const width = piece.classList.contains('flight-back') ? 46 : from.width;
  const height = piece.classList.contains('flight-back') ? 58 : from.height;
  const x = rect => Math.max(16, Math.min(innerWidth - 16, rect.left + rect.width / 2));
  const y = rect => Math.max(16, Math.min(innerHeight - 16, rect.top + rect.height / 2));
  const dx = x(to) - x(from);
  const dy = y(to) - y(from);
  const card = kind === 'card';
  const arc = Math.min(card ? 86 : 48, Math.hypot(dx, dy) * 0.19);
  piece.classList.add('move-flight', `move-flight-${kind}`);
  piece.setAttribute('aria-hidden', 'true');
  Object.assign(piece.style, { left: `${x(from) - width / 2}px`, top: `${y(from) - height / 2}px`, width: `${width}px`, height: `${height}px` });
  app.append(piece);
  const spin = dx >= 0 ? 1 : -1;
  const animation = piece.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, easing: 'cubic-bezier(.28, .02, .57, 1)' },
    { transform: `translate(${dx * .5}px, ${dy * .5 - arc}px) rotate(${spin * (card ? 11 : 23)}deg) scale(${card ? .83 : 1.12})`, opacity: 1, offset: .57, easing: 'cubic-bezier(.3, .03, .38, 1)' },
    { transform: `translate(${dx}px, ${dy}px) scale(${card ? .16 : .38})`, opacity: 0 }
  ], { duration: card ? 780 : 510, delay: index * 70 });
  animation.onfinish = () => {
    if (!piece.isConnected) return;
    piece.remove();
    if (target.isConnected) target.animate([
      { backgroundColor: 'rgba(250, 217, 155, .42)' },
      { backgroundColor: 'rgba(250, 217, 155, 0)' }
    ], { duration: 410, easing: 'ease-out' });
  };
}

function renderRoom() {
  showConnection();
  if (!state) return;
  update('seat-count', `${state.players.length} / ${state.capacity}`);
  update('players', state.players.map(player => `
    <div id="seat-${esc(player.id)}" class="seat ${player.id === state.currentId ? 'active' : ''}">
      <div class="seat-line"><div class="avatar">${esc(Array.from(player.name)[0])}</div>
        <div class="seat-name"><strong>${esc(player.name)}</strong><small>${[
          player.id === state.youId ? '你' : '',
          player.id === state.hostId ? '房主' : '',
          player.id === state.currentId ? '行动中' : ''
        ].filter(Boolean).join(' · ')}</small></div>
        ${state.status === 'waiting' ? '' : `<b class="seat-score">${player.score}<small> 分</small></b>`}
      </div>
      ${state.status === 'waiting' ? '' : `<div class="seat-resources">
        <span class="seat-tokens" title="持有的宝石">宝石 ${costs(player.tokens)}</span>
        <span class="seat-bonuses" title="制作作品带来的加成">加成 ${costs(player.bonuses)}</span>
        <span class="seat-reserved">保留 ${player.reservedCount}</span>
      </div>`}
    </div>`).join(''));
  if (state.status === 'waiting') {
    update('table', `<section class="waiting panel">
      <div class="waiting-art" aria-hidden="true">${gem('green')}${gem('blue')}${gem('gold')}</div>
      <h1>等待开局</h1><p>分享邀请链接，至少两人入席后即可开局。</p>
      <div class="waiting-actions">
        <button data-action="invite">复制邀请链接</button>
        <button class="primary" data-action="start" ${disabled(state.youId !== state.hostId || state.players.length < 2 || busy || !connected)}>${state.youId === state.hostId ? '开始对局' : '等待房主开局'}</button>
      </div>
      <button class="quiet" data-action="leave" ${disabled(busy)}>退出房间</button>
    </section>`);
    return;
  }

  update('table', `
    <div id="status" class="turn-banner"></div>
    <section class="panel supply" aria-labelledby="supply-title">
      <div class="section-head"><h2 id="supply-title">宝石库</h2><span class="muted" id="supply-hint"></span></div>
      <div id="piles" class="piles">${ALL_COLORS.map(color => `<button data-action="gem" data-color="${color}" class="pile" aria-pressed="false">${gem(color)}<span>${LABEL[color]}</span><strong>0</strong></button>`).join('')}</div>
      <div class="supply-controls">
        <div class="modes" aria-label="拿取方式"><button data-action="mode" data-mode="split">不同色</button><button data-action="mode" data-mode="pair">同色 ×2</button></div>
        <button class="primary" data-action="collect">确认拿取</button>
      </div>
      <div id="return-area"></div>
      <div id="my-stock" class="my-stock"></div>
    </section>
    <section class="board" aria-labelledby="board-title">
      <div class="section-head"><h2 id="board-title">工坊</h2><span class="muted">制作获得永久折扣</span></div>
      ${[1, 2, 3].map(level => `<section class="tier" aria-label="${LEVEL[level]}作品">
        <div id="deck-${level}" class="deck"></div>
        ${[0, 1, 2].map(slot => `<div id="work-${level}-${slot}" class="card-slot"></div>`).join('')}
      </section>`).join('')}
    </section>
    <section class="panel commissions"><div class="section-head"><h2>商会委托</h2><span class="muted">达到作品要求后，可用一回合交付</span></div><div class="orders" id="orders"></div></section>
    <section class="panel portfolio"><div class="section-head"><h2>我的保留</h2><span class="muted" id="reserved-count"></span></div><div class="reserved" id="reserved"></div></section>
    <details class="rules"><summary>玩法</summary><p>每回合取两枚不同色宝石、从至少有 4 枚的同色堆取两枚、保留一张牌、制作一件作品或交付一份委托。宝石库只剩一种颜色且不足 4 枚时可取一枚。</p><p>保留给 1 枚金砂（库存充足时），金砂可代替任意颜色。每人最多持有 9 枚宝石、保留 2 张牌。每件作品提供一种颜色的永久折扣。有人达到 16 分时打完本轮，最高分获胜，同分共享胜利。</p></details>`);

  const current = state.players.find(player => player.id === state.currentId);
  const winners = state.players.filter(player => state.winnerIds.includes(player.id)).map(player => player.name);
  update('status', `<div><strong>${state.status === 'finished' ? (winners.length ? esc(winners.join('、')) + ' 获胜' : '对局已结束') : myTurn() ? '你的回合' : esc(current.name) + ' 的回合'}</strong>
    <span>${esc(state.lastMove || '选择宝石，或从工坊开始。')}</span></div>
    ${state.status === 'finished' ? `<button data-action="leave" ${disabled(busy)}>返回大厅</button>` : `<div class="turn-options"><span class="turn-index">${state.finalRound ? '最后一轮 · ' : ''}第 ${state.turn} 回合</span><button class="quiet" data-action="leave" ${disabled(busy)}>退出</button></div>`}`);
  document.querySelector('#status').classList.toggle('your-turn', myTurn());
  const player = you();
  for (const level of [1, 2, 3]) {
    update('deck-' + level, `<strong>${LEVEL[level]}</strong><span>${state.deckCounts[level]} 张</span>
      <button data-action="reserve-deck" data-level="${level}" aria-label="保留${LEVEL[level]}牌堆顶牌" ${disabled(!canAct() || !state.deckCounts[level] || player.reservedCount >= 2)}>保留暗牌</button>`);
    state.market[level].forEach((card, slot) => {
      update(`work-${level}-${slot}`, card ? cardHTML(card) : '<div class="empty-card">牌堆已空</div>');
    });
  }
  update('orders', state.commissions.map(card => {
    const eligible = COLORS.every(color => player.bonuses[color] >= (card.cost[color] || 0));
    return `<article class="order jewel-${card.color}"><div><strong>${esc(card.name)}</strong><span class="points">+${card.points} 分</span></div>
      <div class="fees">${costs(card.cost)}</div>
      <button data-action="commission" data-card="${card.id}" ${disabled(!canAct() || !eligible)}>交付</button></article>`;
  }).join('') || '<p class="empty">所有委托都已完成。</p>');
  update('reserved-count', `${player.reservedCount} / 2`);
  update('reserved', player.reserved.map(card => cardHTML(card, true)).join('') || '<p class="empty">还没有保留作品。</p>');
  const held = Object.values(player.tokens).reduce((total, amount) => total + amount, 0);
  update('my-stock', `<strong>持有 ${held} / 9</strong><div id="stock-tokens" class="fees">${costs(player.tokens)}</div><strong>折扣</strong><div id="stock-bonuses" class="fees">${costs(player.bonuses)}</div>`);

  for (const card of [...Object.values(state.market).flat().filter(Boolean), ...player.reserved]) {
    const element = document.getElementById('card-' + card.id);
    const missing = COLORS.reduce((sum, color) => sum + Math.max(0, (card.cost[color] || 0) - player.bonuses[color] - player.tokens[color]), 0);
    element.querySelector('[data-action="craft"]').disabled = !canAct() || missing > player.tokens.gold;
    const reserve = element.querySelector('[data-action="reserve"]');
    if (reserve) reserve.disabled = !canAct() || player.reservedCount >= 2;
  }
  renderSupply();
}

function costs(values) {
  return ALL_COLORS.filter(color => values[color] > 0).map(color =>
    `<span class="fee" data-color="${color}" title="${LABEL[color]} ${values[color]}" aria-label="${LABEL[color]} ${values[color]}">${gem(color)}<b>${values[color]}</b></span>`
  ).join('') || '<span class="muted">—</span>';
}

function cardHTML(card, reserved = false) {
  return `<article id="card-${card.id}" class="work jewel-${card.color} variant-${card.variant} work-level-${card.level}">
    <div class="work-face">
      <div class="work-art" aria-hidden="true"><i class="inlay"></i>${gem(card.color)}</div>
      <div class="work-title"><span class="work-bonus" title="${LABEL[card.color]}折扣">${gem(card.color)} <span>折扣 +1</span></span><span class="points">+${card.points} 分</span></div>
      <strong class="work-name">${esc(card.name)}</strong>
      <div class="fees" aria-label="制作费用">${costs(card.cost)}</div>
    </div>
    <div class="work-actions"><button data-action="craft" data-card="${card.id}">制作</button>
      ${reserved ? '' : `<button data-action="reserve" data-card="${card.id}">保留</button>`}</div>
  </article>`;
}

function renderSupply() {
  const open = canAct();
  const pairAvailable = COLORS.some(color => state.bank[color] >= 4);
  const splitAvailable = COLORS.filter(color => state.bank[color] > 0).length;
  const required = selectionMode === 'split' && splitAvailable === 1 && !pairAvailable ? 1 : 2;
  const selectedCount = selectionMode === 'pair' && selection.length ? 2 : selection.length;
  document.querySelectorAll('.pile').forEach(button => {
    const { color } = button.dataset;
    const active = selection.includes(color);
    button.disabled = !open || color === 'gold' || state.bank[color] < (selectionMode === 'pair' ? 4 : 1)
      || (selectionMode === 'split' && splitAvailable < 2 && pairAvailable);
    button.setAttribute('aria-pressed', active);
    button.querySelector('strong').textContent = state.bank[color] - (active ? (selectionMode === 'pair' ? 2 : 1) : 0);
  });
  document.querySelectorAll('[data-action="mode"]').forEach(button => {
    button.disabled = !open || (button.dataset.mode === 'pair' ? !pairAvailable : splitAvailable < 2 && pairAvailable);
    button.setAttribute('aria-pressed', selectionMode === button.dataset.mode);
  });
  document.querySelector('[data-action="collect"]').disabled = !open || selectedCount !== required;
  update('supply-hint', open ? `已选 ${selectedCount} / ${required}` : state.returnCount && myTurn() ? '需要归还宝石' : '');
  const area = document.querySelector('#return-area');
  if (!myTurn() || !state.returnCount) {
    update('return-area', '');
    return;
  }
  update('return-area', `<div class="return-box"><strong>归还 ${state.returnCount} 枚宝石 <span id="return-count"></span></strong>
    <div class="return-piles">${ALL_COLORS.map(color => `<button data-action="return-gem" data-color="${color}" aria-label="归还${LABEL[color]}">${gem(color)} <span></span></button>`).join('')}</div>
    <div class="return-actions"><button data-action="clear-return">重选</button><button class="primary" data-action="return">确认归还</button></div></div>`);
  area.querySelector('#return-count').textContent = `（已选 ${returns.length}）`;
  const player = you();
  area.querySelectorAll('[data-action="return-gem"]').forEach(button => {
    const available = player.tokens[button.dataset.color] - count(returns, button.dataset.color);
    button.querySelector('span').textContent = available;
    button.disabled = busy || !connected || !available || returns.length === state.returnCount;
  });
  area.querySelector('[data-action="return"]').disabled = busy || !connected || returns.length !== state.returnCount;
}

function appendMessages(messages, replay = false) {
  const list = document.querySelector('#messages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  let scroll = nearBottom;
  for (const message of messages) {
    if (message.id <= lastMessageId) continue;
    const own = message.playerId === state?.youId;
    const row = document.createElement('article');
    row.className = own ? 'message own' : 'message';
    row.innerHTML = '<div><strong></strong><time></time></div><p></p>';
    row.querySelector('strong').textContent = own ? '我' : message.name;
    row.querySelector('time').textContent = timeFormat.format(message.time);
    row.querySelector('p').textContent = message.text;
    list.querySelector('.empty')?.remove();
    list.append(row);
    if (list.children.length > 100) list.firstElementChild.remove();
    if (!replay && !own && !desktop.matches && !mobileChatOpen) unread += 1;
    if (own) scroll = true;
    lastMessageId = message.id;
  }
  if (scroll) list.scrollTop = list.scrollHeight;
  updateUnread();
}

function updateUnread() {
  const badge = document.querySelector('#unread');
  badge.hidden = !unread;
  badge.textContent = unread > 99 ? '99+' : unread;
}

function connect() {
  stream?.close();
  const source = new EventSource(roomPath('events') + '?key=' + encodeURIComponent(session.key));
  stream = source;
  source.addEventListener('open', () => {
    if (stream !== source) return;
    connected = true;
    renderRoom();
  });
  source.addEventListener('state', event => {
    if (stream === source) acceptState(JSON.parse(event.data));
  });
  source.addEventListener('history', event => {
    if (stream === source) appendMessages(JSON.parse(event.data), lastMessageId === 0);
  });
  source.addEventListener('chat', event => {
    if (stream === source) appendMessages([JSON.parse(event.data)]);
  });
  source.onerror = () => {
    if (stream !== source) return;
    connected = false;
    renderRoom();
    if (source.readyState === EventSource.CLOSED) {
      notify('房间连接已关闭。请刷新页面重试。', true);
    }
  };
}

function remember(data, name) {
  session = { roomId: data.roomId, key: data.key };
  localStorage.setItem('guild_room', data.roomId);
  localStorage.setItem('guild_key', data.key);
  localStorage.setItem('guild_name', name);
  if (invite) history.replaceState(null, '', '/');
  mountRoom();
  acceptState(data.state);
  connect();
}

function resetRoom() {
  stream?.close();
  stream = null;
  state = null;
  session = null;
  connected = false;
  busy = false;
  chatBusy = false;
  localStorage.removeItem('guild_room');
  localStorage.removeItem('guild_key');
  lobbyTab = 'create';
  history.replaceState(null, '', '/');
  renderLobby();
}

async function roomCommand(command, body = {}) {
  if (busy) return;
  busy = true;
  renderRoom();
  try {
    const result = await api(roomPath(command), body, session.key);
    if (command === 'leave') resetRoom();
    else acceptState(result.state);
  } finally {
    busy = false;
    if (state) renderRoom();
  }
}

async function submitChat(form) {
  if (chatBusy || !connected) return;
  const field = form.elements.message;
  const original = field.value;
  if (!original.trim()) return;
  chatBusy = true;
  showConnection();
  try {
    // The stream owns ordering. Rendering the POST response could skip earlier messages.
    await api(roomPath('chat'), { text: original }, session.key);
    if (field.value === original) field.value = '';
  } finally {
    chatBusy = false;
    showConnection();
  }
}

app.addEventListener('submit', async event => {
  const form = event.target;
  event.preventDefault();
  try {
    if (form.dataset.form === 'chat') {
      await submitChat(form);
      return;
    }
    if (joining) return;
    const name = form.elements.name.value.trim();
    if (!name) return notify('请输入昵称。', true);
    joining = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const data = form.dataset.form === 'create'
        ? await api('/api/rooms', { name, capacity: Number(form.elements.capacity.value) })
        : await api('/api/rooms/' + encodeURIComponent(form.elements.room.value.trim().toUpperCase()) + '/join', { name });
      remember(data, name);
    } finally {
      joining = false;
      form.querySelector('button[type="submit"]').disabled = false;
    }
  } catch (error) {
    notify(error.message, true);
  }
});

function toggleChat() {
  mobileChatOpen = !mobileChatOpen;
  const chat = document.querySelector('#chat');
  const toggle = document.querySelector('.chat-toggle');
  chat.classList.toggle('open', mobileChatOpen);
  toggle.setAttribute('aria-expanded', mobileChatOpen);
  if (mobileChatOpen) {
    unread = 0;
    updateUnread();
    const list = document.querySelector('#messages');
    list.scrollTop = list.scrollHeight;
    chat.querySelector('.chat-close').focus();
  } else toggle.focus();
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileChatOpen && !desktop.matches) toggleChat();
});

async function inviteFriend() {
  const url = new URL('/', location.href);
  url.searchParams.set('room', session.roomId);
  try {
    await navigator.clipboard.writeText(url.href);
    notify('邀请链接已复制。');
  } catch {
    window.prompt('复制邀请链接', url.href);
  }
}

app.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const { action, color, card, mode, level, tab } = button.dataset;
  try {
    const play = payload => roomCommand('action', { revision: state.revision, action: payload });
    switch (action) {
      case 'music': await toggleMusic(); break;
      case 'tab':
        if (!joining) {
          lobbyTab = tab;
          renderLobby(document.querySelector('#nickname').value);
          document.querySelector(`[data-tab="${tab}"]`).focus();
        }
        break;
      case 'invite': await inviteFriend(); break;
      case 'chat-toggle': toggleChat(); break;
      case 'start': await roomCommand('start'); break;
      case 'leave':
        if (state.status !== 'playing' || window.confirm('退出会结束本局。确定退出吗？')) await roomCommand('leave');
        break;
      case 'mode':
        if (selectionMode !== mode) {
          selectionMode = mode;
          selection = [];
          renderSupply();
        }
        break;
      case 'gem':
        if (selection.includes(color)) selection = selection.filter(item => item !== color);
        else if (selectionMode === 'pair') selection = [color];
        else selection = [...selection.slice(-1), color];
        renderSupply();
        break;
      case 'collect':
        await play({ type: 'collect', colors: selectionMode === 'pair' ? [selection[0], selection[0]] : selection });
        break;
      case 'return-gem': returns.push(color); renderSupply(); break;
      case 'clear-return': returns = []; renderSupply(); break;
      case 'return': await play({ type: 'return', colors: returns }); break;
      case 'craft':
      case 'commission':
      case 'reserve': await play({ type: action, cardId: card }); break;
      case 'reserve-deck': await play({ type: 'reserve', level: Number(level) }); break;
    }
  } catch (error) {
    notify(error.message, true);
  }
});

async function boot() {
  if (!session?.roomId || !session.key) {
    renderLobby();
    return;
  }
  renderLobby(undefined, true);
  try {
    const result = await api(roomPath(), undefined, session.key);
    mountRoom();
    acceptState(result.state);
    connect();
  } catch (error) {
    if ([403, 404].includes(error.status)) resetRoom();
    else {
      renderLobby();
      notify('暂时无法恢复房间。刷新页面可重试。', true);
      return;
    }
    notify(error.message, true);
  }
}

boot();
