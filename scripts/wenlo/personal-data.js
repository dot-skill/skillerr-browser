// A user's week of jargon-heavy browsing (WEEK1) and the next week's new pages on the same threads (WEEK2), for
// evaluating and testing personal retraining (eval-personal.js, test/wenlo.test.js).
const WEEK1 = {
  japan: ['ryokan near gion', 'Best ryokan in Kyoto with private onsen', 'Arashiyama bamboo grove at sunrise', 'kaiseki dinner gion reservation',
    'shinkansen tokyo to kyoto time', 'JR pass vs shinkansen single tickets', 'Fushimi Inari hike: how long does it take', 'onsen etiquette for tattoos',
    'Nishiki market street food guide', 'ryokan with kaiseki and onsen under 300'],
  rust: ['tokio spawn vs spawn_blocking', 'serde deserialize enum untagged', 'axum middleware tutorial', 'borrow checker cannot move out of',
    'Rust async trait objects explained', 'tokio select loop cancellation', 'serde rename_all camelCase', 'axum extractor ordering',
    'clippy warnings on unwrap', 'cargo workspace dependencies'],
  baby: ['best bassinet for small apartment', 'swaddle vs sleep sack', 'newborn onesie sizes', 'how often to feed a newborn',
    'bassinet mattress safety', 'white noise machine for nursery', 'baby monitor with no wifi', 'swaddle transition when rolling',
    'nursery glider chair', 'hospital bag checklist for delivery'],
  keyboard: ['gateron vs cherry switches', 'hot-swap 75% keyboard kit', 'lubing linear switches', 'pbt keycaps vs abs',
    'gasket mount keyboard sound', 'keychron q1 pro review', 'stabilizers rattle fix', 'tactile switches for typing',
    'foam mod keyboard', 'artisan keycaps'],
  invest: ['vti vs voo', 'expense ratio of index funds', 'roth ira contribution limit', 'dollar cost averaging vs lump sum',
    'vanguard total bond etf', 'three fund portfolio', 'rebalance portfolio once a year', 'tax loss harvesting etf',
    'emergency fund in money market', 'target date fund fees'],
};
const WEEK2 = {
  japan: ['ryokan with onsen in arashiyama', 'kaiseki menu at a kyoto ryokan', 'shinkansen seat reservation', 'gion evening walk geisha district'],
  rust: ['tokio mutex vs std mutex', 'serde skip serializing if none', 'axum state sharing', 'borrow checker lifetime error in closure'],
  baby: ['bassinet vs crib first months', 'swaddle blanket muslin', 'onesie for newborn winter', 'nursery blackout curtains'],
  keyboard: ['gateron yellow lubed', 'keycaps profile cherry vs sa', 'hot-swap sockets repair', 'linear switches for gaming'],
  invest: ['vti expense ratio', 'roth ira backdoor', 'index fund vs etf taxes', 'bond etf in rising rates'],
};

module.exports = { WEEK1, WEEK2 };
