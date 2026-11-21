'use strict';

const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const COLORS_WITH_GOLD = [...COLORS, 'gold'];
const NAMES = ['月白', '潮蓝', '松绿', '珊红', '暮紫'];

// Each pattern gives costs relative to the card's own color in the spectrum.
const PATTERNS = {
  1: [
    [[1, 1, 0, 0, 0], 0],
    [[0, 0, 2, 0, 1], 0],
    [[0, 1, 0, 1, 1], 1],
    [[2, 0, 1, 0, 1], 1],
    [[0, 3, 0, 0, 1], 1],
    [[0, 1, 2, 1, 1], 2]
  ],
  2: [
    [[0, 2, 0, 2, 2], 2],
    [[1, 1, 3, 0, 2], 3],
    [[0, 4, 0, 1, 2], 3],
    [[2, 0, 3, 3, 0], 4],
    [[2, 2, 0, 1, 3], 4]
  ],
  3: [
    [[3, 0, 3, 0, 3], 5],
    [[1, 4, 1, 4, 0], 6],
    [[3, 1, 3, 1, 3], 6],
    [[0, 5, 0, 4, 3], 7]
  ]
};
const FORMS = {
  1: ['棱晶', '星屑', '回声', '晶簇', '弧光', '辉纹'],
  2: ['凝露', '浮镜', '织影', '霞冠', '流环'],
  3: ['日晷', '星盘', '月冕', '天穹']
};

function recipe(offset, amounts) {
  return Object.fromEntries(amounts.flatMap((count, index) =>
    count ? [[COLORS[(offset + index) % COLORS.length], count]] : []
  ));
}

const CARDS = Object.fromEntries([1, 2, 3].map(level => [
  level,
  COLORS.flatMap((color, offset) => PATTERNS[level].map(([amounts, points], index) => ({
    id: `work-${level}-${offset}-${index}`,
    level,
    color,
    variant: (index + level - 1) % 6,
    name: `${NAMES[offset]} · ${FORMS[level][index]}`,
    points,
    cost: recipe(offset, amounts)
  })))
]));

const COMMISSIONS = COLORS.flatMap((color, offset) => [
  { id: `order-${offset}-a`, color, name: `${NAMES[offset]}的回礼`, points: 3, cost: recipe(offset, [2, 0, 2, 0, 0]) },
  { id: `order-${offset}-b`, color, name: `${NAMES[offset]}的远航`, points: 4, cost: recipe(offset, [3, 1, 0, 0, 1]) }
]);

module.exports = { COLORS, COLORS_WITH_GOLD, CARDS, COMMISSIONS };
