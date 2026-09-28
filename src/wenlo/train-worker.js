// Runs personal retraining (train.js) off the main thread, with a hard memory limit set by the caller. The user's trail
// texts live only in this thread's memory and are gone when it ends; only the result comes back.
const { parentPort, workerData } = require('worker_threads');
const { WenloEmbed, encodePersonal } = require('./embed');
const { trainPersonal } = require('./train');

try {
  const base = WenloEmbed.load(workerData.dir);
  let last = 0;
  const r = trainPersonal(workerData.trails, base, workerData.options || {}, (p) => {
    if (p - last >= 0.05 || p === 1) {
      last = p;
      parentPort.postMessage({ progress: p });
    }
  });
  parentPort.postMessage({ done: true, accepted: r.accepted, report: r.report, file: r.accepted ? encodePersonal(r.rows, base.D) : null });
} catch (err) {
  parentPort.postMessage({ done: true, error: err.message });
}
