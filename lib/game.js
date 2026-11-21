'use strict';

const { COLORS, COLORS_WITH_GOLD, CARDS, COMMISSIONS } = require('./cards');

const TOKEN_LIMIT = 9;
const RESERVE_LIMIT = 2;
const TARGET_SCORE = 16;

function emptyGems() {
  return Object.fromEntries(COLORS_WITH_GOLD.map(color => [color, 0]));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makePlayer(id, name) {
  return { id, name, tokens: emptyGems(), bonuses: emptyGems(), works: [], reserved: [], commissions: [], score: 0 };
}

const fail = error => ({ error });

class GuildGame {
  constructor(id, hostId, name, capacity) {
    this.id = id;
    this.hostId = hostId;
    this.capacity = capacity;
    this.players = [makePlayer(hostId, name)];
    this.status = 'waiting';
    this.revision = 0;
    this.turn = 0;
    this.current = 0;
    this.finalRound = false;
    this.returnCount = 0;
    this.decks = {};
    this.market = {};
    this.bank = emptyGems();
    this.commissions = [];
    this.winnerIds = [];
    this.lastMove = '';
  }

  addPlayer(id, name) {
    if (this.status !== 'waiting') return fail('对局已开始。');
    if (this.players.length >= this.capacity) return fail('房间已满。');
    if (this.players.some(player => player.name === name)) return fail('昵称已被本房间的玩家使用。');
    this.players.push(makePlayer(id, name));
    this.revision += 1;
    return {};
  }

  leave(id) {
    if (this.status === 'playing') {
      this.status = 'finished';
      this.returnCount = 0;
      this.lastMove = `${this.players.find(player => player.id === id).name} 退出了本局`;
      this.revision += 1;
      return {};
    }
    if (this.status === 'finished') return {};
    this.players = this.players.filter(player => player.id !== id);
    if (id === this.hostId) this.hostId = this.players[0]?.id;
    this.revision += 1;
    return {};
  }

  start(id) {
    if (id !== this.hostId) return fail('只有房主可以开始对局。');
    if (this.status !== 'waiting' || this.players.length < 2) return fail('至少需要两名玩家才能开局。');
    // The order in this array also defines the boundary of each round.
    this.players = shuffle(this.players);
    for (const level of [1, 2, 3]) {
      this.decks[level] = shuffle(CARDS[level]);
      this.market[level] = this.decks[level].splice(-3);
    }
    for (const color of COLORS) this.bank[color] = this.players.length + 4;
    this.bank.gold = 4;
    this.commissions = shuffle(COMMISSIONS).slice(0, this.players.length + 1);
    this.status = 'playing';
    this.turn = 1;
    this.revision += 1;
    return {};
  }

  play(id, revision, action) {
    const player = this.players[this.current];
    if (this.status !== 'playing' || player.id !== id) return fail('现在不是你的回合。');
    if (revision !== this.revision) return fail('牌桌已更新，请重新确认。');
    if (this.returnCount && action?.type !== 'return') return fail('请先归还超出的宝石。');
    let result;
    switch (action?.type) {
      case 'collect': result = this.collect(player, action.colors); break;
      case 'reserve': result = this.reserve(player, action); break;
      case 'craft': result = this.craft(player, action.cardId); break;
      case 'commission': result = this.claim(player, action.cardId); break;
      case 'return': result = this.returnTokens(player, action.colors); break;
      default: return fail('未知操作。');
    }
    if (result.error) return result;

    this.revision += 1;
    if (result.move) this.lastMove = `${player.name} ${result.move}`;
    this.returnCount = Math.max(0, Object.values(player.tokens).reduce((sum, count) => sum + count, 0) - TOKEN_LIMIT);
    if (!this.returnCount) this.advance(player);
    return {};
  }

  collect(player, colors) {
    if (!Array.isArray(colors) || colors.some(color => !COLORS.includes(color))) return fail('请选择彩色宝石。');
    const available = COLORS.filter(color => this.bank[color] > 0);
    const canTakePair = available.length >= 2 || available.some(color => this.bank[color] >= 4);
    const single = colors.length === 1 && !canTakePair && this.bank[colors[0]] > 0;
    const split = colors.length === 2 && colors[0] !== colors[1] && colors.every(color => this.bank[color] > 0);
    const pair = colors.length === 2 && colors[0] === colors[1] && this.bank[colors[0]] >= 4;
    if (!single && !split && !pair) return fail('选择两种不同色，或从至少有 4 枚的宝石堆取两枚。');
    for (const color of colors) {
      this.bank[color] -= 1;
      player.tokens[color] += 1;
    }
    return { move: `取走了 ${colors.length} 枚宝石` };
  }

  findMarket(cardId) {
    for (const level of [1, 2, 3]) {
      const index = this.market[level].findIndex(card => card?.id === cardId);
      if (index >= 0) return { level, index, card: this.market[level][index] };
    }
    return null;
  }

  replaceMarket({ level, index }) {
    this.market[level][index] = this.decks[level].pop() || null;
  }

  reserve(player, { cardId, level }) {
    if (player.reserved.length >= RESERVE_LIMIT) return fail('保留区已满。');
    const marketSlot = cardId ? this.findMarket(cardId) : null;
    const card = marketSlot?.card || (!cardId && [1, 2, 3].includes(level) ? this.decks[level].pop() : null);
    if (!card) return fail('这张卡已不在工坊。');
    if (marketSlot) this.replaceMarket(marketSlot);
    player.reserved.push(card);
    if (this.bank.gold) {
      this.bank.gold -= 1;
      player.tokens.gold += 1;
    }
    return { move: marketSlot ? `保留了「${card.name}」` : '从牌堆保留了一张暗牌' };
  }

  craft(player, cardId) {
    const marketSlot = this.findMarket(cardId);
    const heldIndex = player.reserved.findIndex(card => card.id === cardId);
    const card = marketSlot?.card || player.reserved[heldIndex];
    if (!card) return fail('这张卡已不在工坊或保留区。');

    const payment = emptyGems();
    for (const color of COLORS) {
      const cost = Math.max(0, (card.cost[color] || 0) - player.bonuses[color]);
      payment[color] = Math.min(cost, player.tokens[color]);
      payment.gold += cost - payment[color];
    }
    if (payment.gold > player.tokens.gold) return fail('材料不足，无法制作。');
    for (const color of COLORS_WITH_GOLD) {
      player.tokens[color] -= payment[color];
      this.bank[color] += payment[color];
    }
    if (marketSlot) this.replaceMarket(marketSlot);
    else player.reserved.splice(heldIndex, 1);

    player.works.push(card);
    player.bonuses[card.color] += 1;
    player.score += card.points;
    return { move: `制作了「${card.name}」` };
  }

  claim(player, cardId) {
    const index = this.commissions.findIndex(card => card.id === cardId);
    if (index < 0) return fail('这份委托已被完成。');
    const card = this.commissions[index];
    if (!COLORS.every(color => player.bonuses[color] >= (card.cost[color] || 0))) return fail('作品条件尚未满足。');
    player.commissions.push(card);
    player.score += card.points;
    this.commissions.splice(index, 1);
    return { move: `交付了「${card.name}」` };
  }

  returnTokens(player, colors) {
    if (!this.returnCount || !Array.isArray(colors) || colors.length !== this.returnCount) {
      return fail(`请归还 ${this.returnCount} 枚宝石。`);
    }
    const remaining = { ...player.tokens };
    for (const color of colors) {
      if (!COLORS_WITH_GOLD.includes(color) || remaining[color] < 1) return fail('你没有足够的该色宝石。');
      remaining[color] -= 1;
    }
    for (const color of colors) this.bank[color] += 1;
    player.tokens = remaining;
    return {};
  }

  advance(player) {
    if (player.score >= TARGET_SCORE) this.finalRound = true;
    this.current = (this.current + 1) % this.players.length;
    if (this.finalRound && this.current === 0) {
      const max = Math.max(...this.players.map(item => item.score));
      this.winnerIds = this.players.filter(item => item.score === max).map(item => item.id);
      this.status = 'finished';
      return;
    }
    this.turn += 1;
  }

  view(id) {
    return {
      roomId: this.id,
      youId: id,
      hostId: this.hostId,
      capacity: this.capacity,
      status: this.status,
      revision: this.revision,
      turn: this.turn,
      currentId: this.status === 'playing' ? this.players[this.current].id : null,
      returnCount: this.returnCount,
      finalRound: this.finalRound,
      winnerIds: this.winnerIds,
      lastMove: this.lastMove,
      bank: this.bank,
      market: this.market,
      deckCounts: Object.fromEntries(Object.entries(this.decks).map(([level, cards]) => [level, cards.length])),
      commissions: this.commissions,
      players: this.players.map(player => ({
        id: player.id,
        name: player.name,
        score: player.score,
        tokens: player.tokens,
        bonuses: player.bonuses,
        reservedCount: player.reserved.length,
        reserved: player.id === id ? player.reserved : []
      }))
    };
  }
}

module.exports = { GuildGame, TOKEN_LIMIT, RESERVE_LIMIT, TARGET_SCORE };
