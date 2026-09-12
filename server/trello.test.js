// node server/trello.test.js —— 用真实卡片形状验证投影逻辑
import assert from 'node:assert/strict';
import { projectTrello, summarize, isDoneList } from './trello.js';

let pass = 0;
const t = (n, f) => { f(); pass++; console.log('  ✓', n); };
const TODAY = '2026-09-13';

// 取自真实 Trello 返回：卡片普遍没有 due，靠列表位置和 dueComplete 表状态
const boards = [
  {
    id: 'b1', name: '⋈仕事', shortUrl: 'https://trello.com/b/Kk3wmYNO',
    lists: [
      { id: 'l_tgs', name: 'TGS2026' },
      { id: 'l_new', name: '【新規開拓】' },
      { id: 'l_empty', name: '目標設定' },
    ],
    cards: [
      { id: 'c1', name: 'アテンドスケジュール', idList: 'l_tgs', due: null, dueComplete: false, desc: '![image.webp](https://trello.com/x.webp)', labels: [], shortUrl: 'https://trello.com/c/9p2joNLq', dateLastActivity: '2026-08-19T00:00:38.401Z' },
      { id: 'c2', name: 'Giantsチケット', idList: 'l_tgs', due: null, dueComplete: true, desc: 'ビジネスディ×1枚', labels: [], shortUrl: 'https://trello.com/c/v4IAe0ur', dateLastActivity: '2026-09-11T07:57:28.089Z' },
      { id: 'c3', name: 'WBチケット', idList: 'l_tgs', due: '2026-09-13T09:00:00.000Z', dueComplete: false, desc: '', labels: [{ color: 'red', name: '' }], shortUrl: 'https://trello.com/c/w', dateLastActivity: '2026-09-10T00:00:00.000Z' },
      { id: 'c4', name: 'Serenity Forge', idList: 'l_new', due: null, dueComplete: false, desc: '', labels: [], shortUrl: 'https://trello.com/c/s', dateLastActivity: '2026-09-01T00:00:00.000Z' },
    ],
  },
  {
    id: 'b2', name: 'TODO', shortUrl: 'https://trello.com/b/MQFlv4ar',
    lists: [{ id: 'l_todo', name: 'To-Do' }, { id: 'l_doing', name: 'Doing' }, { id: 'l_done', name: '🎉 Done' }],
    cards: [
      { id: 'c5', name: '待办一', idList: 'l_todo', due: null, dueComplete: false, desc: '', labels: [], shortUrl: 'u', dateLastActivity: '2026-09-12T00:00:00Z' },
      { id: 'c6', name: '做完的', idList: 'l_done', due: null, dueComplete: false, desc: '', labels: [], shortUrl: 'u', dateLastActivity: '2026-09-11T00:00:00Z' },
    ],
  },
  { id: 'b3', name: '納品情報のお知らせ', shortUrl: 'x', lists: [{ id: 'lx', name: 'A' }], cards: [{ id: 'c9', name: '不该出现', idList: 'lx', due: null, dueComplete: false, labels: [], shortUrl: 'u' }] },
];

const ps = projectTrello(boards, TODAY);

console.log('已完成栏识别');
t('Done / Finish / 完了 命中', () => {
  ['🎉 Done', 'Finish', 'done', '完了', '已完成', 'Completed'].forEach((n) => assert.ok(isDoneList(n), n));
});
t('客户名不会误判', () => {
  ['TGS2026', '【新規開拓】', 'NADA', 'Doing', 'To-Do', '副业'].forEach((n) => assert.ok(!isDoneList(n), n));
});

console.log('投影');
t('排除的看板不出现', () => {
  assert.equal(ps.some((p) => p.board === '納品情報のお知らせ'), false);
});
t('空列表不产生项目', () => {
  assert.equal(ps.some((p) => p.title === '目標設定'), false);
});
t('list → project，board 带在身上', () => {
  const tgs = ps.find((p) => p.title === 'TGS2026');
  assert.equal(tgs.board, '⋈仕事');
  assert.equal(tgs.source, 'trello');
  assert.equal(tgs.read_only, true);
  assert.equal(tgs.tasks.length, 3);
});
t('无 due 的卡片照常保留（这是本设计的关键）', () => {
  const c = ps.flatMap((p) => p.tasks).find((x) => x.title === 'アテンドスケジュール');
  assert.equal(c.due, null);
  assert.equal(c.status, 'todo');
});
t('dueComplete=true → done', () => {
  const c = ps.flatMap((p) => p.tasks).find((x) => x.title === 'Giantsチケット');
  assert.equal(c.status, 'done');
});
t('Done 栏里的卡片 → done', () => {
  const c = ps.flatMap((p) => p.tasks).find((x) => x.title === '做完的');
  assert.equal(c.status, 'done');
});
t('open_count 只数未完成', () => {
  assert.equal(ps.find((p) => p.title === 'TGS2026').open_count, 2); // アテンド + WB
  assert.equal(ps.find((p) => p.title === '🎉 Done').open_count, 0);
});
t('due 转成 JST 日期', () => {
  const c = ps.flatMap((p) => p.tasks).find((x) => x.title === 'WBチケット');
  assert.equal(c.due, '2026-09-13'); // 09-13T09:00Z → JST 18:00 同日
  assert.equal(c.priority, 'p1');    // 今天到期
});
t('desc 里的图片 markdown 被剥掉', () => {
  const c = ps.flatMap((p) => p.tasks).find((x) => x.title === 'アテンドスケジュール');
  assert.equal(c.body, '');
});
t('每张卡都带回 Trello 链接', () => {
  assert.ok(ps.flatMap((p) => p.tasks).every((x) => x.url && x.read_only));
});
t('已完成栏排在最后', () => {
  assert.equal(ps[ps.length - 1].title, '🎉 Done');
});

console.log('汇总');
t('总数与分组正确', () => {
  const s = summarize(ps);
  assert.equal(s.total, 4); // TGS 2 + 新規開拓 1 + To-Do 1
  assert.deepEqual(s.lanes.map((l) => `${l.title}:${l.count}`).sort(), ['TGS2026:2', 'To-Do:1', '【新規開拓】:1']);
});
t('已完成栏不进汇总', () => {
  assert.equal(summarize(ps).lanes.some((l) => l.title === '🎉 Done'), false);
});

console.log(`\n✅ ${pass} passed`);
