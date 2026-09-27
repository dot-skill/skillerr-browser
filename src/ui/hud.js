/* global skillerr, icon, esc, describeStep */
let status = {};
let last = null; // most recent step
const approvals = new Map();

function render() {
  const ring = document.getElementById('ring');
  const btns = document.getElementById('btns');
  const pending = [...approvals.values()].pop();
  const who = status.controller ? status.controller.name : 'AI';
  if (pending) {
    ring.className = 'ring ask';
    document.getElementById('name').textContent = `${pending.controller} needs your OK`;
    document.getElementById('step').textContent = describeStep(pending).text;
    btns.innerHTML = '<button class="b deny">Deny</button><button class="b allow">Allow</button>';
    btns.querySelector('.allow').onclick = () => skillerr.send('approval', { id: pending.id, ok: true });
    btns.querySelector('.deny').onclick = () => skillerr.send('approval', { id: pending.id, ok: false });
  } else if (status.paused) {
    ring.className = 'ring paused';
    document.getElementById('name').textContent = 'AI paused';
    document.getElementById('step').textContent = 'You have control of the browser';
    btns.innerHTML = `<button class="b resume">${icon('play', 11)}Let ${esc(who)} continue</button>`;
    btns.querySelector('.resume').onclick = () => skillerr.send('pause', false);
  } else {
    ring.className = 'ring';
    document.getElementById('name').textContent = `${who} is driving`;
    document.getElementById('step').textContent = last ? describeStep(last).text : 'Getting started…';
    btns.innerHTML = `<button class="b take">${icon('hand', 14)}Take over</button>`;
    btns.querySelector('.take').onclick = () => skillerr.send('pause', true);
  }
}

skillerr.on('status', (s) => { status = s; render(); });
skillerr.on('log', (e) => {
  if (e.state === 'approval') approvals.set(e.id, e);
  else approvals.delete(e.id);
  if (e.state !== 'approval') last = e;
  render();
});
render();
