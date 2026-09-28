/* global skillerr */
const cap = document.getElementById('cap');
skillerr.on('caption', (text) => {
  if (!text) return cap.classList.remove('on');
  cap.classList.remove('on');
  // restart the entrance so each new line reads as a new beat
  requestAnimationFrame(() => {
    cap.textContent = text;
    requestAnimationFrame(() => cap.classList.add('on'));
  });
});
