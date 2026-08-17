'use strict';

const GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'];
const GOLD = 'gold';
const TOKEN_COLORS = [...GEM_COLORS, GOLD];
const GEM_TOKEN_COUNT = {
  2: 4,
  3: 5,
  4: 7
};
const GOLD_TOKEN_COUNT = 5;
const FACE_UP_COUNT = 4;

const STANDARD_NOBLES = [
  { cost: { white: 4, blue: 4 } },
  { cost: { blue: 4, green: 4 } },
  { cost: { green: 4, red: 4 } },
  { cost: { red: 4, black: 4 } },
  { cost: { black: 4, white: 4 } },
  { cost: { white: 3, blue: 3, green: 3 } },
  { cost: { blue: 3, green: 3, red: 3 } },
  { cost: { green: 3, red: 3, black: 3 } },
  { cost: { red: 3, black: 3, white: 3 } },
  { cost: { black: 3, white: 3, blue: 3 } }
];

function zeroTokens() {
  const tokens = {};
  for (const color of TOKEN_COLORS) tokens[color] = 0;
  return tokens;
}

function cloneTokens(tokens) {
  return { ...tokens };
}

function sumTokens(tokens) {
  return TOKEN_COLORS.reduce((sum, color) => sum + tokens[color], 0);
}

function gemSum(tokens) {
  return GEM_COLORS.reduce((sum, color) => sum + tokens[color], 0);
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateCost(total) {
  const cost = {};
  for (const color of GEM_COLORS) cost[color] = 0;

  let remaining = total;
  while (remaining > 0) {
    const choices = GEM_COLORS.filter((color) => cost[color] < 5);
    if (choices.length === 0) break;
    const color = randomItem(choices);
    cost[color] += 1;
    remaining -= 1;
  }

  return cost;
}

function generateDeck(level, count) {
  const cards = [];

  for (let i = 0; i < count; i += 1) {
    let total;
    let points;

    if (level === 1) {
      total = 3 + Math.floor(Math.random() * 3);
      points = total >= 5 ? 1 : 0;
    } else if (level === 2) {
      total = 5 + Math.floor(Math.random() * 4);
      points = total <= 5 ? 1 : total <= 7 ? 2 : 3;
    } else {
      total = 7 + Math.floor(Math.random() * 4);
      points = total <= 7 ? 3 : total <= 9 ? 4 : 5;
    }

    cards.push({
      id: `card_${level}_${i + 1}`,
      level,
      color: randomItem(GEM_COLORS),
      cost: generateCost(total),
      points
    });
  }

  return shuffle(cards);
}

function makeNobles(playerCount) {
  return shuffle(
    STANDARD_NOBLES.map((noble, index) => ({
      id: `noble_${index + 1}`,
      cost: { ...noble.cost },
      points: 3
    }))
  ).slice(0, playerCount + 1);
}

function cardCostAfterDiscount(card, player) {
  const cost = {};
  for (const color of GEM_COLORS) {
    cost[color] = Math.max(0, (card.cost[color] || 0) - player.bonuses[color]);
  }
  return cost;
}

function isCardAffordable(card, player) {
  const discounted = cardCostAfterDiscount(card, player);
  const missing = GEM_COLORS.reduce(
    (sum, color) => sum + Math.max(0, discounted[color] - player.tokens[color]),
    0
  );
  return missing <= player.tokens[GOLD];
}

function payForCard(card, player, bank) {
  const discounted = cardCostAfterDiscount(card, player);
  const paidGems = {};
  let goldUsed = 0;

  for (const color of GEM_COLORS) {
    const needed = discounted[color] || 0;
    const regularPaid = Math.min(player.tokens[color], needed);
    player.tokens[color] -= regularPaid;
    bank[color] += regularPaid;
    paidGems[color] = regularPaid;
    goldUsed += needed - regularPaid;
  }

  player.tokens[GOLD] -= goldUsed;
  bank[GOLD] += goldUsed;
  paidGems[GOLD] = goldUsed;

  return paidGems;
}

function isNobleSatisfied(player, noble) {
  return GEM_COLORS.every(
    (color) => player.bonuses[color] >= (noble.cost[color] || 0)
  );
}

class SplendorGame {
  constructor(roomId, hostId, hostName, maxPlayers) {
    this.roomId = roomId;
    this.hostId = hostId;
    this.maxPlayers = maxPlayers;
    this.players = [
      {
        id: hostId,
        name: hostName,
        tokens: zeroTokens(),
        cards: [],
        reserved: [],
        nobles: [],
        bonuses: this.emptyBonuses(),
        connectedAt: Date.now()
      }
    ];
    this.status = 'waiting';
    this.currentPlayerIndex = 0;
    this.currentPlayerId = hostId;
    this.bank = zeroTokens();
    this.decks = { 1: [], 2: [], 3: [] };
    this.faceUp = { 1: [], 2: [], 3: [] };
    this.nobles = [];
    this.pendingDiscard = null;
    this.pendingNoble = null;
    this.finalRoundsRemaining = null;
    this.winner = null;
    this.turnNumber = 0;
    this.createdAt = Date.now();
    this.log = [];
  }

  emptyBonuses() {
    const bonuses = {};
    for (const color of GEM_COLORS) bonuses[color] = 0;
    return bonuses;
  }

  playerById(playerId) {
    return this.players.find((player) => player.id === playerId);
  }

  host() {
    return this.playerById(this.hostId);
  }

  getPlayerScore(player) {
    return player.cards.reduce((sum, card) => sum + card.points, 0)
      + player.nobles.reduce((sum, noble) => sum + noble.points, 0);
  }

  addPlayer(playerId, name) {
    if (this.status !== 'waiting') {
      return { ok: false, error: '游戏已经开始，不能加入。' };
    }
    if (this.players.length >= this.maxPlayers) {
      return { ok: false, error: '房间已满。' };
    }
    if (this.players.some((player) => player.name === name)) {
      return { ok: false, error: '房间内已有同名玩家。' };
    }

    this.players.push({
      id: playerId,
      name,
      tokens: zeroTokens(),
      cards: [],
      reserved: [],
      nobles: [],
      bonuses: this.emptyBonuses(),
      connectedAt: Date.now()
    });
    this.log.push({ type: 'join', playerId, name });
    return { ok: true };
  }

  canStart() {
    return this.status === 'waiting' && this.players.length >= 2;
  }

  start() {
    if (!this.canStart()) {
      return { ok: false, error: '至少需要 2 名玩家才能开始游戏。' };
    }

    this.status = 'playing';
    this.decks = {
      1: generateDeck(1, 40),
      2: generateDeck(2, 30),
      3: generateDeck(3, 20)
    };
    this.faceUp = { 1: [], 2: [], 3: [] };

    for (const level of [1, 2, 3]) {
      for (let i = 0; i < FACE_UP_COUNT; i += 1) {
        this.faceUp[level].push(this.decks[level].pop());
      }
    }

    const gemCount = GEM_TOKEN_COUNT[this.players.length];
    this.bank = zeroTokens();
    for (const color of GEM_COLORS) this.bank[color] = gemCount;
    this.bank[GOLD] = GOLD_TOKEN_COUNT;

    this.nobles = makeNobles(this.players.length);
    this.currentPlayerIndex = Math.floor(Math.random() * this.players.length);
    this.currentPlayerId = this.players[this.currentPlayerIndex].id;
    this.finalRoundsRemaining = null;
    this.winner = null;
    this.turnNumber = 1;
    this.log.push({ type: 'start', playerCount: this.players.length });
    return { ok: true };
  }

  deckCounts() {
    return {
      1: this.decks[1].length,
      2: this.decks[2].length,
      3: this.decks[3].length
    };
  }

  availableNoblesFor(player) {
    return this.nobles.filter((noble) => isNobleSatisfied(player, noble));
  }

  acquireNoble(player, noble) {
    const index = this.nobles.findIndex((item) => item.id === noble.id);
    if (index >= 0) this.nobles.splice(index, 1);
    player.nobles.push(noble);
    this.log.push({ type: 'noble', playerId: player.id, nobleId: noble.id });
  }

  replaceFaceUp(level) {
    if (this.decks[level].length > 0) {
      this.faceUp[level].push(this.decks[level].pop());
    }
  }

  takeGems(player, colors) {
    if (!Array.isArray(colors) || (colors.length !== 2 && colors.length !== 3)) {
      return { ok: false, error: '只能拿取 2 枚同色或 3 枚不同色的宝石。' };
    }

    if (colors.some((color) => !GEM_COLORS.includes(color))) {
      return { ok: false, error: '该操作不能拿取黄金。' };
    }

    const isTwoSame = colors.length === 2 && colors[0] === colors[1];
    const isThreeDifferent =
      colors.length === 3 && new Set(colors).size === colors.length;

    if (!isTwoSame && !isThreeDifferent) {
      return { ok: false, error: '拿取方式不合法。' };
    }

    if (isTwoSame && this.bank[colors[0]] < 4) {
      return { ok: false, error: '同色宝石只剩不足 4 枚，不能一次拿取 2 枚。' };
    }

    if (isThreeDifferent && colors.some((color) => this.bank[color] < 1)) {
      return { ok: false, error: '所选宝石中有一种已经耗尽。' };
    }

    for (const color of colors) {
      this.bank[color] -= 1;
      player.tokens[color] += 1;
    }

    this.log.push({
      type: 'take',
      playerId: player.id,
      colors: colors.slice()
    });
    return { ok: true };
  }

  reserveCard(player, payload) {
    if (player.reserved.length >= 3) {
      return { ok: false, error: '最多只能保留 3 张卡牌。' };
    }

    let card = null;
    let source = null;

    if (payload && payload.source === 'faceUp' && payload.cardId) {
      for (const level of [1, 2, 3]) {
        const index = this.faceUp[level].findIndex((item) => item.id === payload.cardId);
        if (index >= 0) {
          [card] = this.faceUp[level].splice(index, 1);
          this.replaceFaceUp(level);
          source = 'faceUp';
          break;
        }
      }
    } else if (payload && payload.source === 'deck' && [1, 2, 3].includes(payload.level)) {
      const level = payload.level;
      if (this.decks[level].length === 0) {
        return { ok: false, error: '该等级牌堆已经耗尽。' };
      }
      card = this.decks[level].pop();
      source = 'deck';
    } else {
      return { ok: false, error: '请选择要保留的卡牌。' };
    }

    if (!card) {
      return { ok: false, error: '未找到该卡牌。' };
    }

    player.reserved.push(card);
    if (this.bank[GOLD] > 0) {
      this.bank[GOLD] -= 1;
      player.tokens[GOLD] += 1;
    }

    this.log.push({
      type: 'reserve',
      playerId: player.id,
      cardId: card.id,
      source
    });
    return { ok: true };
  }

  buyCard(player, payload) {
    if (!payload || !payload.cardId) {
      return { ok: false, error: '请选择要购买的卡牌。' };
    }

    let card = null;
    let source = null;
    let faceUpLevel = null;

    for (const level of [1, 2, 3]) {
      const index = this.faceUp[level].findIndex((item) => item.id === payload.cardId);
      if (index >= 0) {
        [card] = this.faceUp[level].splice(index, 1);
        faceUpLevel = level;
        source = 'faceUp';
        break;
      }
    }

    if (!card) {
      const reservedIndex = player.reserved.findIndex((item) => item.id === payload.cardId);
      if (reservedIndex >= 0) {
        [card] = player.reserved.splice(reservedIndex, 1);
        source = 'reserved';
      }
    }

    if (!card) {
      return { ok: false, error: '未找到该卡牌。' };
    }

    if (!isCardAffordable(card, player)) {
      return { ok: false, error: '宝石不足，无法购买这张卡牌。' };
    }

    payForCard(card, player, this.bank);
    player.cards.push(card);
    player.bonuses[card.color] += 1;

    if (source === 'faceUp') {
      this.replaceFaceUp(faceUpLevel);
    }

    this.log.push({
      type: 'buy',
      playerId: player.id,
      cardId: card.id,
      source
    });
    return { ok: true };
  }

  returnTokens(player, colors) {
    if (!this.pendingDiscard || this.pendingDiscard.playerId !== player.id) {
      return { ok: false, error: '当前不需要归还宝石。' };
    }
    if (!Array.isArray(colors) || colors.length !== this.pendingDiscard.count) {
      return {
        ok: false,
        error: `需要归还 ${this.pendingDiscard.count} 枚宝石。`
      };
    }

    const held = cloneTokens(player.tokens);
    for (const color of colors) {
      if (!TOKEN_COLORS.includes(color) || held[color] <= 0) {
        return { ok: false, error: '所选宝石与手牌不符。' };
      }
      held[color] -= 1;
    }

    for (const color of colors) {
      player.tokens[color] -= 1;
      this.bank[color] += 1;
    }
    this.pendingDiscard = null;
    this.log.push({
      type: 'return',
      playerId: player.id,
      colors: colors.slice()
    });
    return { ok: true };
  }

  chooseNoble(player, nobleId) {
    if (!this.pendingNoble || this.pendingNoble.playerId !== player.id) {
      return { ok: false, error: '当前不需要选择贵族。' };
    }
    if (!this.pendingNoble.optionIds.includes(nobleId)) {
      return { ok: false, error: '该贵族不在可选项内。' };
    }

    const noble = this.nobles.find((item) => item.id === nobleId);
    if (!noble) {
      return { ok: false, error: '未找到该贵族。' };
    }

    this.acquireNoble(player, noble);
    this.afterNoble(player);
    return { ok: true };
  }

  endTurnAfterDiscard(player) {
    this.endTurn(player);
  }

  endTurn(player) {
    const eligible = this.availableNoblesFor(player);
    if (eligible.length > 1) {
      this.pendingNoble = {
        playerId: player.id,
        optionIds: eligible.map((noble) => noble.id)
      };
      return;
    }

    if (eligible.length === 1) {
      this.acquireNoble(player, eligible[0]);
    }

    this.afterNoble(player);
  }

  afterNoble(player) {
    this.pendingNoble = null;
    const score = this.getPlayerScore(player);

    if (score >= 15 && this.finalRoundsRemaining === null) {
      this.finalRoundsRemaining = this.players.length - 1;
      this.log.push({ type: 'finalRound', playerId: player.id, score });
    } else if (this.finalRoundsRemaining !== null) {
      this.finalRoundsRemaining -= 1;
      if (this.finalRoundsRemaining <= 0) {
        this.finishGame();
        return;
      }
    }

    this.advanceTurn();
  }

  advanceTurn() {
    this.pendingDiscard = null;
    this.pendingNoble = null;
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.currentPlayerId = this.players[this.currentPlayerIndex].id;
    this.turnNumber += 1;
  }

  finishGame() {
    this.status = 'finished';
    this.pendingDiscard = null;
    this.pendingNoble = null;

    const ranked = this.players
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: this.getPlayerScore(player),
        cardCount: player.cards.length
      }))
      .sort((a, b) => b.score - a.score || a.cardCount - b.cardCount);

    const topScore = ranked[0].score;
    const topCards = ranked.find((item) => item.score === topScore).cardCount;
    this.winner = ranked
      .filter((item) => item.score === topScore && item.cardCount === topCards)
      .map((item) => item.id);
    this.log.push({
      type: 'finished',
      winners: this.winner.slice(),
      score: topScore
    });
  }

  viewForPlayer(viewerId) {
    const viewer = this.playerById(viewerId);
    return {
      roomId: this.roomId,
      status: this.status,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      youId: viewerId,
      currentPlayerId: this.currentPlayerId,
      finalRound: this.finalRoundsRemaining !== null,
      finalRoundsRemaining: this.finalRoundsRemaining,
      winner: this.winner,
      turnNumber: this.turnNumber,
      bank: cloneTokens(this.bank),
      faceUp: {
        1: this.faceUp[1].map((card) => this.publicCard(card)),
        2: this.faceUp[2].map((card) => this.publicCard(card)),
        3: this.faceUp[3].map((card) => this.publicCard(card))
      },
      deckCounts: this.deckCounts(),
      nobles: this.nobles.map((noble) => ({ ...noble, cost: { ...noble.cost } })),
      pendingDiscard: this.pendingDiscard
        ? { playerId: this.pendingDiscard.playerId, count: this.pendingDiscard.count }
        : null,
      pendingNoble: this.pendingNoble
        ? {
            playerId: this.pendingNoble.playerId,
            optionIds: this.pendingNoble.optionIds.slice()
          }
        : null,
      players: this.players.map((player) => this.playerView(player, player.id === viewerId)),
      log: this.log.slice(-20)
    };
  }

  publicCard(card) {
    return {
      id: card.id,
      level: card.level,
      color: card.color,
      cost: { ...card.cost },
      points: card.points
    };
  }

  playerView(player, isViewer) {
    return {
      id: player.id,
      name: player.name,
      score: this.getPlayerScore(player),
      tokens: cloneTokens(player.tokens),
      tokenCount: sumTokens(player.tokens),
      bonuses: { ...player.bonuses },
      cards: player.cards.map((card) => this.publicCard(card)),
      reserved: isViewer
        ? player.reserved.map((card) => this.publicCard(card))
        : player.reserved.map(() => ({ hidden: true })),
      reservedCount: player.reserved.length,
      nobles: player.nobles.map((noble) => ({ ...noble, cost: { ...noble.cost } }))
    };
  }
}

module.exports = {
  SplendorGame,
  GEM_COLORS,
  GOLD,
  TOKEN_COLORS,
  GEM_TOKEN_COUNT,
  GOLD_TOKEN_COUNT
};
