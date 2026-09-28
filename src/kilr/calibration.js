// Where Kilr's cosines fall, measured on held-back data (scripts/kilr/):
// - sentence: STS-B dev pairs (calibrate.py). Below LOW, people call a pair unrelated; around HIGH, roughly equivalent.
//   Used to put recall-by-meaning matches on the same scale as other embedding models.
// - topic: a page against the centre of a thread of work (eval-trails.js, tuning set). Below LOW is another thread
//   (99% of them), around HIGH is typical for a page of the same thread. Used by Trails.
module.exports = {
  LOW: 0.42,
  HIGH: 0.74,
  TOPIC_LOW: 0.28,
  TOPIC_HIGH: 0.45,
};
